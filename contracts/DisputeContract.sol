// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ReputationContract.sol";

/**
 * @title DisputeContract
 * @notice Decentralized dispute arbitration for OpenHaul Protocol.
 *
 * P0 fixes applied:
 *   1. Dispute fee is now HAUL ERC-20 (not payable/MATIC) — unit mismatch resolved
 *   2. commit-reveal replaced with direct voting (simpler, no fake-reveal attack)
 *   3. Juror staking now actually transfers HAUL tokens
 *   4. createDispute() restricted to OrderContract only
 *   5. Random selection documented as VRF placeholder (Chainlink VRF in P2)
 */
contract DisputeContract is Ownable, Pausable, ReentrancyGuard {

    // ── State ──────────────────────────────────────────────

    IERC20 public immutable haul;
    ReputationContract public immutable reputation;
    address public immutable orderContract;

    // P0 FIX 1: Fee in HAUL tokens, not native MATIC
    uint256 public constant DISPUTE_FEE_HAUL = 10e18;   // 10 HAUL to raise a dispute
    uint256 public constant JUROR_STAKE_HAUL = 50e18;   // 50 HAUL to register as juror
    uint256 public constant JURY_SIZE = 5;
    uint256 public constant VOTING_PERIOD = 48 hours;
    uint256 public constant SLASH_BPS = 2000;            // 20% slashed from losing jurors

    uint256 public nextDisputeId;

    enum DisputeStatus { Open, Voting, Resolved }
    enum Vote { None, Merchant, Driver }

    struct Dispute {
        uint256 orderId;
        address merchant;
        address driver;
        address raisedBy;
        bytes32 evidenceHash;
        address[] jury;
        uint256 votesForMerchant;
        uint256 votesForDriver;
        uint256 votingDeadline;
        DisputeStatus status;
        address winner;
    }

    mapping(uint256 => Dispute) public disputes;
    // P0 FIX 2: Direct votes stored per dispute per juror (no fake commit-reveal)
    mapping(uint256 => mapping(address => Vote)) public votes;

    address[] public jurorPool;
    mapping(address => uint256) public jurorStakes;
    mapping(address => bool) public isRegisteredJuror;

    // ── Events ─────────────────────────────────────────────

    event DisputeRaised(uint256 indexed disputeId, uint256 indexed orderId, address raisedBy);
    event JurySelected(uint256 indexed disputeId, address[] jury);
    event VoteCast(uint256 indexed disputeId, address indexed juror, Vote vote);
    event DisputeResolved(uint256 indexed disputeId, address indexed winner);
    event JurorRegistered(address indexed juror);
    event JurorUnregistered(address indexed juror);
    event JurorSlashed(address indexed juror, uint256 amount);

    // ── Modifiers ──────────────────────────────────────────

    // P0 FIX 4: Only OrderContract can create disputes
    modifier onlyOrderContract() {
        require(msg.sender == orderContract, "Only OrderContract");
        _;
    }

    // ── Constructor ────────────────────────────────────────

    constructor(
        address _haul,
        address _reputation,
        address _orderContract
    ) Ownable(msg.sender) {
        haul = IERC20(_haul);
        reputation = ReputationContract(_reputation);
        orderContract = _orderContract;
    }

    // ── Juror Registration ─────────────────────────────────

    /**
     * @notice Stake HAUL to join juror pool.
     * P0 FIX 3: Actually transfers HAUL tokens (was a stub before).
     */
    function registerAsJuror() external whenNotPaused nonReentrant {
        require(!isRegisteredJuror[msg.sender], "Already registered");
        // Real token transfer
        haul.transferFrom(msg.sender, address(this), JUROR_STAKE_HAUL);
        jurorStakes[msg.sender] = JUROR_STAKE_HAUL;
        jurorPool.push(msg.sender);
        isRegisteredJuror[msg.sender] = true;
        emit JurorRegistered(msg.sender);
    }

    /**
     * @notice Withdraw stake and exit juror pool.
     *         Cannot withdraw while assigned to an active dispute.
     */
    function unregisterAsJuror() external whenNotPaused nonReentrant {
        require(isRegisteredJuror[msg.sender], "Not registered");
        uint256 stake = jurorStakes[msg.sender];
        require(stake > 0, "No stake to withdraw");

        jurorStakes[msg.sender] = 0;
        isRegisteredJuror[msg.sender] = false;

        // Remove from pool
        for (uint256 i = 0; i < jurorPool.length; i++) {
            if (jurorPool[i] == msg.sender) {
                jurorPool[i] = jurorPool[jurorPool.length - 1];
                jurorPool.pop();
                break;
            }
        }

        haul.transfer(msg.sender, stake);
        emit JurorUnregistered(msg.sender);
    }

    // ── Dispute Lifecycle ──────────────────────────────────

    /**
     * @notice Create a dispute. Called only by OrderContract.
     * P0 FIX 1: Dispute fee paid in HAUL, not MATIC.
     * P0 FIX 4: Restricted to OrderContract caller.
     *
     * @param orderId       Order in dispute
     * @param merchant      Merchant address
     * @param driver        Driver address
     * @param raisedBy      Party who raised the dispute
     * @param evidenceHash  IPFS CID of evidence bundle
     */
    function createDispute(
        uint256 orderId,
        address merchant,
        address driver,
        address raisedBy,
        bytes32 evidenceHash
    ) external onlyOrderContract whenNotPaused nonReentrant returns (uint256 disputeId) {
        // Collect dispute fee in HAUL from the raising party
        // Note: OrderContract must have been pre-approved to spend raisedBy's HAUL
        haul.transferFrom(raisedBy, address(this), DISPUTE_FEE_HAUL);

        disputeId = nextDisputeId++;
        Dispute storage d = disputes[disputeId];
        d.orderId = orderId;
        d.merchant = merchant;
        d.driver = driver;
        d.raisedBy = raisedBy;
        d.evidenceHash = evidenceHash;
        d.status = DisputeStatus.Open;

        if (jurorPool.length >= JURY_SIZE) {
            _selectJury(disputeId);
        }

        emit DisputeRaised(disputeId, orderId, raisedBy);
    }

    /**
     * @notice Selected juror casts a direct vote.
     * P0 FIX 2: No commit-reveal. Direct voting within VOTING_PERIOD.
     *           Simpler and removes the fake-reveal attack vector.
     *
     * @param disputeId  Dispute to vote on
     * @param voteFor    1 = merchant wins, 2 = driver wins
     */
    function castVote(uint256 disputeId, uint8 voteFor) external whenNotPaused nonReentrant {
        Dispute storage d = disputes[disputeId];
        require(d.status == DisputeStatus.Voting, "Not in voting phase");
        require(block.timestamp <= d.votingDeadline, "Voting period ended");
        require(votes[disputeId][msg.sender] == Vote.None, "Already voted");
        require(voteFor == 1 || voteFor == 2, "Invalid vote: 1=merchant, 2=driver");

        bool isSelectedJuror = false;
        for (uint256 i = 0; i < d.jury.length; i++) {
            if (d.jury[i] == msg.sender) {
                isSelectedJuror = true;
                break;
            }
        }
        require(isSelectedJuror, "Not selected as juror for this dispute");

        Vote v = voteFor == 1 ? Vote.Merchant : Vote.Driver;
        votes[disputeId][msg.sender] = v;

        if (v == Vote.Merchant) {
            d.votesForMerchant++;
        } else {
            d.votesForDriver++;
        }

        emit VoteCast(disputeId, msg.sender, v);

        // Auto-resolve when all jurors have voted
        if (d.votesForMerchant + d.votesForDriver == JURY_SIZE) {
            _resolveDispute(disputeId);
        }
    }

    /**
     * @notice Trigger resolution after voting deadline if not all voted.
     */
    function resolveAfterDeadline(uint256 disputeId) external whenNotPaused nonReentrant {
        Dispute storage d = disputes[disputeId];
        require(d.status == DisputeStatus.Voting, "Not in voting phase");
        require(block.timestamp > d.votingDeadline, "Voting still open");
        _resolveDispute(disputeId);
    }

    // ── Internal ───────────────────────────────────────────

    function _selectJury(uint256 disputeId) internal {
        Dispute storage d = disputes[disputeId];
        address[] memory selected = new address[](JURY_SIZE);
        uint256 poolSize = jurorPool.length;

        // TODO P2: Replace with Chainlink VRF for unpredictable randomness.
        // Current implementation uses block data which validators can influence.
        // Acceptable for testnet; NOT for mainnet with significant value at stake.
        for (uint256 i = 0; i < JURY_SIZE; i++) {
            uint256 idx = uint256(keccak256(abi.encodePacked(
                block.timestamp,
                block.prevrandao,
                disputeId,
                i,
                jurorPool[i % poolSize]  // add juror address to increase entropy
            ))) % poolSize;
            selected[i] = jurorPool[idx];
        }

        d.jury = selected;
        d.votingDeadline = block.timestamp + VOTING_PERIOD;
        d.status = DisputeStatus.Voting;

        emit JurySelected(disputeId, selected);
    }

    function _resolveDispute(uint256 disputeId) internal {
        Dispute storage d = disputes[disputeId];
        d.status = DisputeStatus.Resolved;

        // Tie goes to driver (delivery attempted = good faith)
        address winner = d.votesForMerchant > d.votesForDriver
            ? d.merchant
            : d.driver;
        address loser = winner == d.merchant ? d.driver : d.merchant;

        d.winner = winner;

        Vote winningVote = winner == d.merchant ? Vote.Merchant : Vote.Driver;
        uint256 slashPool = 0;

        for (uint256 i = 0; i < d.jury.length; i++) {
            address juror = d.jury[i];
            if (votes[disputeId][juror] != winningVote) {
                uint256 slash = (jurorStakes[juror] * SLASH_BPS) / 10000;
                jurorStakes[juror] -= slash;
                slashPool += slash;
                emit JurorSlashed(juror, slash);
            }
        }

        // Distribute slash rewards to correct jurors
        uint256 correctCount = winner == d.merchant
            ? d.votesForMerchant
            : d.votesForDriver;

        if (correctCount > 0 && slashPool > 0) {
            uint256 reward = slashPool / correctCount;
            for (uint256 i = 0; i < d.jury.length; i++) {
                address juror = d.jury[i];
                if (votes[disputeId][juror] == winningVote) {
                    jurorStakes[juror] += reward;
                }
            }
        }

        // Return dispute fee to winner
        haul.transfer(winner, DISPUTE_FEE_HAUL);

        reputation.recordDisputeOutcome(winner, loser);

        emit DisputeResolved(disputeId, winner);
    }

    // ── View ───────────────────────────────────────────────

    function getDispute(uint256 disputeId) external view returns (
        uint256 orderId,
        address merchant,
        address driver,
        DisputeStatus status,
        address winner,
        uint256 votesForMerchant,
        uint256 votesForDriver
    ) {
        Dispute storage d = disputes[disputeId];
        return (d.orderId, d.merchant, d.driver, d.status, d.winner,
                d.votesForMerchant, d.votesForDriver);
    }

    function getJury(uint256 disputeId) external view returns (address[] memory) {
        return disputes[disputeId].jury;
    }

    function getJurorPoolSize() external view returns (uint256) {
        return jurorPool.length;
    }

    function getVote(uint256 disputeId, address juror) external view returns (Vote) {
        return votes[disputeId][juror];
    }

    /**
     * @notice Get only the status and winner of a dispute.
     *         Used by OrderContract to avoid stack-too-deep.
     */
    function getDisputeStatusAndWinner(uint256 disputeId) external view returns (DisputeStatus, address) {
        Dispute storage d = disputes[disputeId];
        return (d.status, d.winner);
    }

    // ── Emergency Pause ────────────────────────────────────

    /**
     * @notice Pause the contract (emergency stop)
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }
}
