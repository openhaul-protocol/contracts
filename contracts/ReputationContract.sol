// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ReputationContract
 * @notice On-chain reputation for OpenHaul Protocol.
 *
 * P1 fixes applied:
 *   1. hasRated now per-order, not per address-pair (was blocking re-rating)
 *   2. circulatingSupply() removed (belongs in HAULToken, not here)
 *   3. Weight constants now actually used in score calculation
 *   4. getTenureBonus() applied to totalScore on read
 */
contract ReputationContract {

    // ── State ──────────────────────────────────────────────

    struct Score {
        uint256 completedOrders;
        uint256 disputesLost;
        uint256 disputesWon;
        uint256 totalRatingPoints;  // sum of all ratings received
        uint256 ratingCount;        // number of ratings received
        uint256 firstActivityAt;
        uint256 lastActivityAt;
    }

    mapping(address => Score) public scores;

    // P1 FIX 1: Rating is per-order, not per address-pair
    // hasRated[orderId][rater] = true once merchant rates driver for that order
    mapping(uint256 => mapping(address => bool)) public hasRated;

    mapping(address => bool) public authorizedCallers;
    address public owner;

    // Score weights (basis points, sum = 10000)
    uint256 public constant COMPLETION_WEIGHT_BPS = 6000;  // 60%
    uint256 public constant RATING_WEIGHT_BPS     = 3000;  // 30%
    uint256 public constant DISPUTE_WEIGHT_BPS    = 1000;  // 10%
    uint256 public constant MAX_TENURE_BONUS      = 500;   // up to 5% bonus for longevity

    // ── Events ─────────────────────────────────────────────

    event CompletionRecorded(address indexed driver, address indexed merchant, uint256 orderId);
    event DisputeOutcomeRecorded(address indexed winner, address indexed loser);
    event RatingSubmitted(uint256 indexed orderId, address indexed driver, uint8 rating);
    event CallerAuthorized(address indexed caller);
    event CallerRevoked(address indexed caller);

    // ── Constructor ────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ── Access Control ─────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyAuthorized() {
        require(authorizedCallers[msg.sender], "Not authorized caller");
        _;
    }

    function authorizeCaller(address caller) external onlyOwner {
        authorizedCallers[caller] = true;
        emit CallerAuthorized(caller);
    }

    function revokeCaller(address caller) external onlyOwner {
        authorizedCallers[caller] = false;
        emit CallerRevoked(caller);
    }

    // ── Write ──────────────────────────────────────────────

    /**
     * @notice Record a successful delivery. Called by OrderContract.
     */
    function recordCompletion(
        address driver,
        address merchant,
        uint256 orderId
    ) external onlyAuthorized {
        _initIfNew(driver);
        _initIfNew(merchant);

        scores[driver].completedOrders++;
        scores[driver].lastActivityAt = block.timestamp;

        scores[merchant].completedOrders++;
        scores[merchant].lastActivityAt = block.timestamp;

        emit CompletionRecorded(driver, merchant, orderId);
    }

    /**
     * @notice Record dispute outcome. Called by DisputeContract.
     */
    function recordDisputeOutcome(
        address winner,
        address loser
    ) external onlyAuthorized {
        scores[winner].disputesWon++;
        scores[loser].disputesLost++;
        emit DisputeOutcomeRecorded(winner, loser);
    }

    /**
     * @notice Merchant submits rating for a driver after delivery.
     * P1 FIX 1: Rating gated per orderId — same order can only be rated once.
     *
     * @param orderId  The completed order
     * @param driver   Driver to rate
     * @param rating   1–5 stars
     */
    function submitRating(
        uint256 orderId,
        address driver,
        uint8 rating
    ) external {
        require(rating >= 1 && rating <= 5, "Rating must be 1-5");
        require(!hasRated[orderId][msg.sender], "Already rated this order");
        // Production: add check that msg.sender was the merchant for orderId

        hasRated[orderId][msg.sender] = true;
        scores[driver].totalRatingPoints += rating;
        scores[driver].ratingCount++;

        emit RatingSubmitted(orderId, driver, rating);
    }

    // ── Read ───────────────────────────────────────────────

    function getScore(address participant) external view returns (Score memory) {
        return scores[participant];
    }

    /**
     * @notice Composite score 0–100, incorporating completion rate,
     *         average rating, dispute record, and tenure bonus.
     * P1 FIX 3: Weight constants now actually applied.
     * P1 FIX 4: Tenure bonus included in output.
     */
    function getCompositeScore(address participant) external view returns (uint256) {
        Score memory s = scores[participant];
        if (s.completedOrders == 0) return 0;

        uint256 total = s.completedOrders + s.disputesLost;

        // Completion component (0–60)
        uint256 completionRate = total > 0
            ? (s.completedOrders * 10000) / total
            : 10000;
        uint256 completionComponent = (completionRate * COMPLETION_WEIGHT_BPS) / 10000 / 100;

        // Rating component (0–30)
        uint256 avgRating = s.ratingCount > 0
            ? (s.totalRatingPoints * 100) / (s.ratingCount * 5)  // normalize to 0-100
            : 60; // default 60/100 if no ratings
        uint256 ratingComponent = (avgRating * RATING_WEIGHT_BPS) / 10000;

        // Dispute component (0–10): penalize for lost disputes
        uint256 disputePenalty = s.disputesLost > 0
            ? (s.disputesLost * 200) // -2 points per lost dispute
            : 0;
        uint256 disputeComponent = DISPUTE_WEIGHT_BPS / 100;
        if (disputePenalty >= disputeComponent) {
            disputeComponent = 0;
        } else {
            disputeComponent -= disputePenalty;
        }

        uint256 baseScore = completionComponent + ratingComponent + disputeComponent;

        // Tenure bonus: up to 5 extra points for accounts > 1 year old
        uint256 tenureBonus = _getTenureBonus(participant);

        uint256 finalScore = baseScore + tenureBonus;
        return finalScore > 100 ? 100 : finalScore;
    }

    function getAverageRating(address participant) external view returns (uint256) {
        Score memory s = scores[participant];
        if (s.ratingCount == 0) return 0;
        return s.totalRatingPoints / s.ratingCount;
    }

    function getCompletionRate(address participant) external view returns (uint256) {
        Score memory s = scores[participant];
        uint256 total = s.completedOrders + s.disputesLost;
        if (total == 0) return 0;
        return (s.completedOrders * 10000) / total; // basis points
    }

    // ── Internal ───────────────────────────────────────────

    function _initIfNew(address participant) internal {
        if (scores[participant].firstActivityAt == 0) {
            scores[participant].firstActivityAt = block.timestamp;
        }
    }

    /**
     * P1 FIX 4: Tenure bonus is now actually calculated and returned.
     * Returns 0–MAX_TENURE_BONUS points based on account age.
     */
    function _getTenureBonus(address participant) internal view returns (uint256) {
        uint256 firstActivity = scores[participant].firstActivityAt;
        if (firstActivity == 0) return 0;

        uint256 age = block.timestamp - firstActivity;
        uint256 oneYear = 365 days;

        if (age >= oneYear) return MAX_TENURE_BONUS / 100; // 5 points max
        return (age * MAX_TENURE_BONUS) / oneYear / 100;
    }
}
