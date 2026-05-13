// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./ReputationContract.sol";

/**
 * @title DisputeContract
 * @dev Kleros-inspired decentralized arbitration for OpenHaul Protocol
 * Handles disputes between shippers and carriers with juror-based resolution
 */
contract DisputeContract is Ownable, ReentrancyGuard {
    
    ReputationContract public reputationContract;
    
    // Dispute parameters
    uint256 public constant MIN_JURORS = 3;
    uint256 public constant MAX_JURORS = 15;
    uint256 public constant JUROR_STAKE = 100 * 10**18; // 100 HAUL
    uint256 public constant DISPUTE_FEE = 50 * 10**18;   // 50 HAUL
    uint256 public constant VOTING_PERIOD = 7 days;
    uint256 public constant EVIDENCE_PERIOD = 3 days;
    uint256 public constant APPEAL_PERIOD = 2 days;
    
    // Dispute states
    enum DisputeState {
        None,
        Evidence,       // Evidence submission phase
        Voting,         // Jurors voting
        Appealable,     // Decision can be appealed
        Resolved,       // Final decision reached
        Executed        // Ruling executed
    }
    
    // Vote choices
    enum Ruling {
        RefusedToRule,
        ShippingPartyWins,  // Shipper/carrier (initiator)
        CarryingPartyWins   // Counterparty
    }
    
    struct Dispute {
        uint256 disputeId;
        uint256 orderId;
        address initiator;
        address respondent;
        string reason;
        uint256 evidenceDeadline;
        uint256 votingDeadline;
        uint256 appealDeadline;
        DisputeState state;
        Ruling finalRuling;
        uint256 shippingPartyVotes;
        uint256 carryingPartyVotes;
        uint256 totalJurors;
        uint256 amountAtStake;
        bool appealUsed;
    }
    
    struct Juror {
        address jurorAddress;
        uint256 stakedAmount;
        uint256 casesAdjudicated;
        uint256 casesWon;
        bool isActive;
    }
    
    struct Vote {
        Ruling choice;
        bool committed;
        bool revealed;
    }
    
    // State variables
    uint256 public nextDisputeId;
    mapping(uint256 => Dispute) public disputes;
    mapping(uint256 => mapping(address => Vote)) public votes;
    mapping(uint256 => address[]) public disputeJurors;
    mapping(address => Juror) public jurors;
    mapping(uint256 => mapping(address => string)) public evidence;
    
    address[] public activeJurorList;
    
    // Events
    event DisputeCreated(
        uint256 indexed disputeId,
        uint256 indexed orderId,
        address indexed initiator,
        address respondent
    );
    event EvidenceSubmitted(
        uint256 indexed disputeId,
        address indexed submitter,
        string evidenceURI
    );
    event VoteCommitted(
        uint256 indexed disputeId,
        address indexed juror
    );
    event VoteRevealed(
        uint256 indexed disputeId,
        address indexed juror,
        Ruling ruling
    );
    event DisputeResolved(
        uint256 indexed disputeId,
        Ruling finalRuling
    );
    event JurorStaked(address indexed juror, uint256 amount);
    event JurorUnstaked(address indexed juror, uint256 amount);
    event AppealFiled(uint256 indexed disputeId);
    
    modifier onlyJuror() {
        require(jurors[msg.sender].isActive, "Not an active juror");
        _;
    }
    
    modifier validDispute(uint256 _disputeId) {
        require(_disputeId < nextDisputeId, "Invalid dispute ID");
        _;
    }
    
    constructor(address _reputationContract) Ownable(msg.sender) {
        reputationContract = ReputationContract(_reputationContract);
    }
    
    /**
     * @dev Stake HAUL tokens to become a juror
     */
    function stakeAsJuror() external nonReentrant {
        require(!jurors[msg.sender].isActive, "Already a juror");
        
        // In production, transfer HAUL tokens here
        jurors[msg.sender] = Juror({
            jurorAddress: msg.sender,
            stakedAmount: JUROR_STAKE,
            casesAdjudicated: 0,
            casesWon: 0,
            isActive: true
        });
        
        activeJurorList.push(msg.sender);
        emit JurorStaked(msg.sender, JUROR_STAKE);
    }
    
    /**
     * @dev Unstake and exit juror role
     */
    function unstakeAsJuror() external nonReentrant {
        require(jurors[msg.sender].isActive, "Not a juror");
        
        Juror storage juror = jurors[msg.sender];
        uint256 amount = juror.stakedAmount;
        
        juror.isActive = false;
        juror.stakedAmount = 0;
        
        // Remove from active list
        for (uint256 i = 0; i < activeJurorList.length; i++) {
            if (activeJurorList[i] == msg.sender) {
                activeJurorList[i] = activeJurorList[activeJurorList.length - 1];
                activeJurorList.pop();
                break;
            }
        }
        
        // In production, return HAUL tokens here
        emit JurorUnstaked(msg.sender, amount);
    }
    
    /**
     * @dev Create a new dispute
     */
    function createDispute(
        uint256 _orderId,
        address _respondent,
        string calldata _reason,
        uint256 _amountAtStake
    ) external payable returns (uint256) {
        require(msg.value >= DISPUTE_FEE, "Insufficient dispute fee");
        require(_respondent != msg.sender, "Cannot dispute yourself");
        require(activeJurorList.length >= MIN_JURORS, "Not enough jurors");
        
        uint256 disputeId = nextDisputeId++;
        
        disputes[disputeId] = Dispute({
            disputeId: disputeId,
            orderId: _orderId,
            initiator: msg.sender,
            respondent: _respondent,
            reason: _reason,
            evidenceDeadline: block.timestamp + EVIDENCE_PERIOD,
            votingDeadline: 0,
            appealDeadline: 0,
            state: DisputeState.Evidence,
            finalRuling: Ruling.RefusedToRule,
            shippingPartyVotes: 0,
            carryingPartyVotes: 0,
            totalJurors: 0,
            amountAtStake: _amountAtStake,
            appealUsed: false
        });
        
        emit DisputeCreated(disputeId, _orderId, msg.sender, _respondent);
        return disputeId;
    }
    
    /**
     * @dev Submit evidence for a dispute
     */
    function submitEvidence(
        uint256 _disputeId,
        string calldata _evidenceURI
    ) external validDispute(_disputeId) {
        Dispute storage dispute = disputes[_disputeId];
        require(
            dispute.state == DisputeState.Evidence,
            "Not in evidence phase"
        );
        require(
            block.timestamp <= dispute.evidenceDeadline,
            "Evidence period ended"
        );
        require(
            msg.sender == dispute.initiator || msg.sender == dispute.respondent,
            "Not a party to this dispute"
        );
        
        evidence[_disputeId][msg.sender] = _evidenceURI;
        emit EvidenceSubmitted(_disputeId, msg.sender, _evidenceURI);
    }
    
    /**
     * @dev Start voting phase (called by anyone after evidence period)
     */
    function startVoting(uint256 _disputeId) external validDispute(_disputeId) {
        Dispute storage dispute = disputes[_disputeId];
        require(
            dispute.state == DisputeState.Evidence,
            "Not in evidence phase"
        );
        require(
            block.timestamp > dispute.evidenceDeadline,
            "Evidence period not ended"
        );
        
        // Select random jurors
        uint256 jurorCount = activeJurorList.length < MAX_JURORS 
            ? activeJurorList.length 
            : MAX_JURORS;
        
        address[] memory selected = _selectRandomJurors(jurorCount);
        disputeJurors[_disputeId] = selected;
        dispute.totalJurors = selected.length;
        
        dispute.votingDeadline = block.timestamp + VOTING_PERIOD;
        dispute.state = DisputeState.Voting;
    }
    
    /**
     * @dev Commit vote (hidden vote)
     */
    function commitVote(
        uint256 _disputeId,
        bytes32 _commitment
    ) external onlyJuror validDispute(_disputeId) {
        Dispute storage dispute = disputes[_disputeId];
        require(dispute.state == DisputeState.Voting, "Not in voting phase");
        require(block.timestamp <= dispute.votingDeadline, "Voting ended");
        
        // Verify juror is assigned to this dispute
        bool isAssigned = false;
        for (uint256 i = 0; i < disputeJurors[_disputeId].length; i++) {
            if (disputeJurors[_disputeId][i] == msg.sender) {
                isAssigned = true;
                break;
            }
        }
        require(isAssigned, "Not assigned to this dispute");
        
        votes[_disputeId][msg.sender].committed = true;
        emit VoteCommitted(_disputeId, msg.sender);
    }
    
    /**
     * @dev Reveal vote
     */
    function revealVote(
        uint256 _disputeId,
        Ruling _choice,
        bytes32 _salt
    ) external onlyJuror validDispute(_disputeId) {
        Dispute storage dispute = disputes[_disputeId];
        require(dispute.state == DisputeState.Voting, "Not in voting phase");
        require(
            block.timestamp > dispute.votingDeadline,
            "Voting still ongoing"
        );
        
        Vote storage vote = votes[_disputeId][msg.sender];
        require(vote.committed, "No vote committed");
        require(!vote.revealed, "Already revealed");
        
        // Verify commitment (simplified)
        vote.choice = _choice;
        vote.revealed = true;
        
        if (_choice == Ruling.ShippingPartyWins) {
            dispute.shippingPartyVotes++;
        } else if (_choice == Ruling.CarryingPartyWins) {
            dispute.carryingPartyVotes++;
        }
        
        emit VoteRevealed(_disputeId, msg.sender, _choice);
    }
    
    /**
     * @dev Resolve dispute after voting
     */
    function resolveDispute(
        uint256 _disputeId
    ) external validDispute(_disputeId) {
        Dispute storage dispute = disputes[_disputeId];
        require(dispute.state == DisputeState.Voting, "Not in voting phase");
        require(
            block.timestamp > dispute.votingDeadline,
            "Voting still ongoing"
        );
        
        // Determine winner
        if (dispute.shippingPartyVotes > dispute.carryingPartyVotes) {
            dispute.finalRuling = Ruling.ShippingPartyWins;
        } else if (dispute.carryingPartyVotes > dispute.shippingPartyVotes) {
            dispute.finalRuling = Ruling.CarryingPartyWins;
        } else {
            dispute.finalRuling = Ruling.RefusedToRule;
        }
        
        dispute.appealDeadline = block.timestamp + APPEAL_PERIOD;
        dispute.state = DisputeState.Appealable;
        
        // Update juror stats
        _updateJurorStats(_disputeId);
        
        emit DisputeResolved(_disputeId, dispute.finalRuling);
    }
    
    /**
     * @dev Appeal a decision (one-time)
     */
    function appeal(uint256 _disputeId) external payable validDispute(_disputeId) {
        Dispute storage dispute = disputes[_disputeId];
        require(dispute.state == DisputeState.Appealable, "Not appealable");
        require(!dispute.appealUsed, "Already appealed");
        require(
            msg.sender == dispute.initiator || msg.sender == dispute.respondent,
            "Not a party"
        );
        require(msg.value >= DISPUTE_FEE * 2, "Insufficient appeal fee");
        
        dispute.appealUsed = true;
        dispute.state = DisputeState.Evidence;
        dispute.evidenceDeadline = block.timestamp + EVIDENCE_PERIOD;
        dispute.votingDeadline = 0;
        dispute.shippingPartyVotes = 0;
        dispute.carryingPartyVotes = 0;
        dispute.totalJurors = 0;
        
        // Clear previous votes
        for (uint256 i = 0; i < disputeJurors[_disputeId].length; i++) {
            delete votes[_disputeId][disputeJurors[_disputeId][i]];
        }
        delete disputeJurors[_disputeId];
        
        emit AppealFiled(_disputeId);
    }
    
    /**
     * @dev Execute final ruling
     */
    function executeRuling(
        uint256 _disputeId
    ) external validDispute(_disputeId) nonReentrant {
        Dispute storage dispute = disputes[_disputeId];
        require(
            dispute.state == DisputeState.Appealable,
            "Not appealable"
        );
        require(
            block.timestamp > dispute.appealDeadline,
            "Appeal period not ended"
        );
        
        dispute.state = DisputeState.Executed;
        
        // Update reputation for both parties
        if (dispute.finalRuling == Ruling.ShippingPartyWins) {
            reputationContract.recordDisputeOutcome(
                dispute.initiator,
                true,
                false
            );
            reputationContract.recordDisputeOutcome(
                dispute.respondent,
                false,
                false
            );
        } else if (dispute.finalRuling == Ruling.CarryingPartyWins) {
            reputationContract.recordDisputeOutcome(
                dispute.initiator,
                false,
                false
            );
            reputationContract.recordDisputeOutcome(
                dispute.respondent,
                true,
                false
            );
        } else {
            // Refused to rule - no fault
            reputationContract.recordDisputeOutcome(
                dispute.initiator,
                false,
                true
            );
            reputationContract.recordDisputeOutcome(
                dispute.respondent,
                false,
                true
            );
        }
    }
    
    /**
     * @dev Select random jurors (simplified - use Chainlink VRF in production)
     */
    function _selectRandomJurors(
        uint256 _count
    ) internal view returns (address[] memory) {
        address[] memory selected = new address[](_count);
        uint256 seed = uint256(keccak256(abi.encodePacked(
            block.timestamp,
            block.prevrandao,
            msg.sender
        )));
        
        for (uint256 i = 0; i < _count; i++) {
            uint256 index = (seed + i) % activeJurorList.length;
            selected[i] = activeJurorList[index];
        }
        
        return selected;
    }
    
    /**
     * @dev Update juror statistics after resolution
     */
    function _updateJurorStats(uint256 _disputeId) internal {
        Dispute storage dispute = disputes[_disputeId];
        
        for (uint256 i = 0; i < disputeJurors[_disputeId].length; i++) {
            address jurorAddr = disputeJurors[_disputeId][i];
            Vote storage vote = votes[_disputeId][jurorAddr];
            
            if (vote.revealed) {
                jurors[jurorAddr].casesAdjudicated++;
                if (vote.choice == dispute.finalRuling) {
                    jurors[jurorAddr].casesWon++;
                }
            }
        }
    }
    
    /**
     * @dev Get dispute details
     */
    function getDispute(
        uint256 _disputeId
    ) external view returns (Dispute memory) {
        return disputes[_disputeId];
    }
    
    /**
     * @dev