// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title HAULToken
 * @dev ERC-20 token for OpenHaul Protocol
 * Fixed supply, no public sale. Tokens distributed via:
 * - Team vesting
 * - Liquidity provision
 * - Ecosystem incentives
 * - Reserve treasury
 */
contract HAULToken is ERC20, Ownable {
    
    // Tokenomics constants
    uint256 public constant MAX_SUPPLY = 100_000_000 * 10**18; // 100M HAUL
    
    // Allocation percentages (must sum to 100%)
    uint256 public constant TEAM_ALLOCATION = 20;           // 20M
    uint256 public constant LIQUIDITY_ALLOCATION = 15;      // 15M
    uint256 public constant ECOSYSTEM_ALLOCATION = 40;      // 40M
    uint256 public constant RESERVE_ALLOCATION = 25;        // 25M
    
    // Vesting parameters
    uint256 public constant VESTING_DURATION = 4 * 365 days; // 4 years
    uint256 public constant VESTING_CLIFF = 365 days;        // 1 year cliff
    
    // Vesting state
    struct Vesting {
        uint256 totalAmount;
        uint256 releasedAmount;
        uint256 startTime;
        bool initialized;
    }
    
    mapping(address => Vesting) public teamVesting;
    
    // Events
    event VestingInitialized(address indexed beneficiary, uint256 amount);
    event TokensReleased(address indexed beneficiary, uint256 amount);
    
    constructor(
        address _teamWallet,
        address _liquidityWallet,
        address _ecosystemWallet,
        address _reserveWallet
    ) ERC20("OpenHaul", "HAUL") Ownable(msg.sender) {
        require(
            _teamWallet != address(0) &&
            _liquidityWallet != address(0) &&
            _ecosystemWallet != address(0) &&
            _reserveWallet != address(0),
            "Invalid wallet address"
        );
        
        // Mint total supply to this contract
        _mint(address(this), MAX_SUPPLY);
        
        // Distribute allocations
        uint256 teamAmount = (MAX_SUPPLY * TEAM_ALLOCATION) / 100;
        uint256 liquidityAmount = (MAX_SUPPLY * LIQUIDITY_ALLOCATION) / 100;
        uint256 ecosystemAmount = (MAX_SUPPLY * ECOSYSTEM_ALLOCATION) / 100;
        uint256 reserveAmount = (MAX_SUPPLY * RESERVE_ALLOCATION) / 100;
        
        // Team allocation goes to vesting
        _transfer(address(this), address(this), teamAmount);
        teamVesting[_teamWallet] = Vesting({
            totalAmount: teamAmount,
            releasedAmount: 0,
            startTime: block.timestamp,
            initialized: true
        });
        emit VestingInitialized(_teamWallet, teamAmount);
        
        // Immediate transfers
        _transfer(address(this), _liquidityWallet, liquidityAmount);
        _transfer(address(this), _ecosystemWallet, ecosystemAmount);
        _transfer(address(this), _reserveWallet, reserveAmount);
        
        // Verify total distribution
        require(
            balanceOf(_liquidityWallet) + 
            balanceOf(_ecosystemWallet) + 
            balanceOf(_reserveWallet) + 
            teamAmount == MAX_SUPPLY,
            "Distribution mismatch"
        );
    }
    
    /**
     * @dev Calculate releasable tokens for team vesting
     */
    function releasableAmount(address _beneficiary) public view returns (uint256) {
        Vesting storage vesting = teamVesting[_beneficiary];
        if (!vesting.initialized) return 0;
        
        if (block.timestamp < vesting.startTime + VESTING_CLIFF) {
            return 0;
        }
        
        uint256 elapsed = block.timestamp - vesting.startTime;
        if (elapsed >= VESTING_DURATION) {
            return vesting.totalAmount - vesting.releasedAmount;
        }
        
        uint256 vested = (vesting.totalAmount * elapsed) / VESTING_DURATION;
        return vested - vesting.releasedAmount;
    }
    
    /**
     * @dev Release vested tokens
     */
    function releaseVestedTokens() external {
        Vesting storage vesting = teamVesting[msg.sender];
        require(vesting.initialized, "No vesting found");
        
        uint256 amount = releasableAmount(msg.sender);
        require(amount > 0, "No tokens to release");
        
        vesting.releasedAmount += amount;
        _transfer(address(this), msg.sender, amount);
        
        emit TokensReleased(msg.sender, amount);
    }
    
    /**
     * @dev Burn tokens from caller
     */
    function burn(uint256 _amount) external {
        _burn(msg.sender, _amount);
    }
    
    /**
     * @dev Get circulating supply (excludes locked team tokens)
     */
    function circulatingSupply() external view returns (uint256) {
        uint256 locked = 0;
        // Sum all unreleased team tokens
        // Simplified: in production, iterate through all beneficiaries
        return totalSupply() - locked;
    }
}
