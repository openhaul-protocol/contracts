// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title ReputationContract
 * @dev On-chain reputation system for OpenHaul Protocol
 * Each user owns their reputation score, built through:
 * - Completed orders
 * - Dispute resolution outcomes
 * - Peer ratings
 * - Platform tenure
 */
contract ReputationContract is Ownable, ReentrancyGuard {
    
    // Score parameters
    uint256 public constant MAX_SCORE = 1000;
    uint256 public constant BASE_SCORE = 100;
    uint256 public constant MIN_SCORE = 0;
    
    // Weight factors (must sum to 100)
    uint256 public constant COMPLETION_WEIGHT = 40;
    uint256 public constant RATING_WEIGHT = 30;
    uint256 public constant DISPUTE_WEIGHT = 20;
    uint256 public constant TENURE_WEIGHT = 10;
    
    // Score change values
    int256 public constant COMPLETION_BONUS = 5;
    int256 public constant POSITIVE_RATING_BONUS = 10;
    int256 public constant NEGATIVE_RATING_PENALTY = -15;
    int256 public constant DISPUTE_WON_BONUS = 15;
    int256 public constant DISPUTE_LOST_PENALTY = -25;
    int256 public constant DISPUTE_NO_FAULT = 0;
    
    // Reputation data per user
    struct Reputation {
        uint256 totalScore;
        uint256 completedOrders;
        uint256 totalRatings;
        uint256 positiveRatings;
        uint256 negativeRatings;
        uint256 disputesWon;
        uint256 disputesLost;
        uint256 registrationTime;
        bool isRegistered;
    }
    
    mapping(address => Reputation) public reputations;
    mapping(address => mapping(address => bool)) public hasRated;
    
    // Authorized contracts that can update reputation
    mapping(address => bool) public authorizedUpdaters;
    
    // Events
    event ReputationUpdated(
        address indexed user,
        uint256 newScore,
        string reason
    );
    event UserRegistered(address indexed user);
    event RatingSubmitted(
        address indexed rater,
        address indexed ratee,
        bool isPositive,
        uint256 orderId
    );
    event UpdaterAuthorized(address indexed updater);
    event UpdaterRevoked(address indexed updater);
    
    modifier onlyAuthorized() {
        require(
            authorizedUpdaters[msg.sender] || msg.sender == owner(),
            "Not authorized"
        );
        _;
    }
    
    modifier onlyRegistered(address _user) {
        require(reputations[_user].isRegistered, "User not registered");
        _;
    }
    
    /**
     * @dev Register a new user in the reputation system
     */
    function register() external {
        require(!reputations[msg.sender].isRegistered, "Already registered");
        
        reputations[msg.sender] = Reputation({
            totalScore: BASE_SCORE,
            completedOrders: 0,
            totalRatings: 0,
            positiveRatings: 0,
            negativeRatings: 0,
            disputesWon: 0,
            disputesLost: 0,
            registrationTime: block.timestamp,
            isRegistered: true
        });
        
        emit UserRegistered(msg.sender);
        emit ReputationUpdated(msg.sender, BASE_SCORE, "Registration");
    }
    
    /**
     * @dev Authorize a contract to update reputation
     */
    function authorizeUpdater(address _updater) external onlyOwner {
        authorizedUpdaters[_updater] = true;
        emit UpdaterAuthorized(_updater);
    }
    
    /**
     * @dev Revoke updater authorization
     */
    function revokeUpdater(address _updater) external onlyOwner {
        authorizedUpdaters[_updater] = false;
        emit UpdaterRevoked(_updater);
    }
    
    /**
     * @dev Record completed order (called by OrderContract)
     */
    function recordCompletion(address _user) external onlyAuthorized onlyRegistered(_user) {
        Reputation storage rep = reputations[_user];
        rep.completedOrders++;
        
        _updateScore(_user, COMPLETION_BONUS, "Order completion");
    }
    
    /**
     * @dev Submit a rating for another user
     */
    function submitRating(
        address _ratee,
        bool _isPositive,
        uint256 _orderId
    ) external onlyRegistered(msg.sender) onlyRegistered(_ratee) {
        require(msg.sender != _ratee, "Cannot rate yourself");
        require(!hasRated[msg.sender][_ratee], "Already rated this user");
        
        Reputation storage rep = reputations[_ratee];
        rep.totalRatings++;
        hasRated[msg.sender][_ratee] = true;
        
        if (_isPositive) {
            rep.positiveRatings++;
            _updateScore(_ratee, POSITIVE_RATING_BONUS, "Positive rating");
        } else {
            rep.negativeRatings++;
            _updateScore(_ratee, NEGATIVE_RATING_PENALTY, "Negative rating");
        }
        
        emit RatingSubmitted(msg.sender, _ratee, _isPositive, _orderId);
    }
    
    /**
     * @dev Record dispute outcome (called by DisputeContract)
     */
    function recordDisputeOutcome(
        address _user,
        bool _won,
        bool _noFault
    ) external onlyAuthorized onlyRegistered(_user) {
        Reputation storage rep = reputations[_user];
        
        if (_noFault) {
            _updateScore(_user, DISPUTE_NO_FAULT, "Dispute no fault");
        } else if (_won) {
            rep.disputesWon++;
            _updateScore(_user, DISPUTE_WON_BONUS, "Dispute won");
        } else {
            rep.disputesLost++;
            _updateScore(_user, DISPUTE_LOST_PENALTY, "Dispute lost");
        }
    }
    
    /**
     * @dev Internal function to update score with bounds checking
     */
    function _updateScore(
        address _user,
        int256 _delta,
        string memory _reason
    ) internal {
        Reputation storage rep = reputations[_user];
        
        uint256 newScore;
        if (_delta >= 0) {
            newScore = rep.totalScore + uint256(_delta);
            if (newScore > MAX_SCORE) newScore = MAX_SCORE;
        } else {
            uint256 penalty = uint256(-_delta);
            if (rep.totalScore <= penalty) {
                newScore = MIN_SCORE;
            } else {
                newScore = rep.totalScore - penalty;
            }
        }
        
        rep.totalScore = newScore;
        emit ReputationUpdated(_user, newScore, _reason);
    }
    
    /**
     * @dev Get user reputation score
     */
    function getScore(address _user) external view returns (uint256) {
        return reputations[_user].totalScore;
    }
    
    /**
     * @dev Get detailed reputation info
     */
    function getReputation(address _user) external view returns (Reputation memory) {
        return reputations[_user];
    }
    
    /**
     * @dev Calculate tenure bonus
     */
    function getTenureBonus(address _user) external view returns (uint256) {
        if (!reputations[_user].isRegistered) return 0;
        
        uint256 tenure = block.timestamp - reputations[_user].registrationTime;
        // 1 point per year, max 10 points
        uint256 yearsActive = tenure / 365 days;
        return yearsActive > 10 ? 10 : yearsActive;
    }
    
    /**
     * @dev Check if user meets minimum reputation threshold
     */
    function meetsThreshold(
        address _user,
        uint256 _minScore
    ) external view returns (bool) {
        return reputations[_user].isRegistered && reputations[_user].totalScore >= _minScore;
    }
    
    /**
     * @dev Get reputation tier
     */
    function getTier(address _user) external view returns (string memory) {
        uint256 score = reputations[_user].totalScore;
        
        if (score >= 900) return "Diamond";
        if (score >= 700) return "Platinum";
        if (score >= 500) return "Gold";
        if (score >= 300) return "Silver";
        if (score >= 100) return "Bronze";
        return "New";
    }
}
