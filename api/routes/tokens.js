/**
 * Token Routes
 * HAUL token information and balances
 */

const express = require('express');
const router = express.Router();
const { param, validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/**
 * @route   GET /api/v1/tokens/haul/info
 * @desc    Get HAUL token info
 */
router.get('/haul/info', async (req, res, next) => {
  try {
    const { haulToken } = req.contracts;

    const [name, symbol, decimals, totalSupply, maxSupply] = await Promise.all([
      haulToken.name(),
      haulToken.symbol(),
      haulToken.decimals(),
      haulToken.totalSupply(),
      haulToken.MAX_SUPPLY()
    ]);

    res.json({
      success: true,
      data: {
        name,
        symbol,
        decimals: Number(decimals),
        totalSupply: totalSupply.toString(),
        maxSupply: maxSupply.toString(),
        address: process.env.HAUL_TOKEN_ADDRESS
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/v1/tokens/haul/balance/:address
 * @desc    Get HAUL balance for address
 */
router.get('/haul/balance/:address', [
  param('address').isEthereumAddress(),
  validate
], async (req, res, next) => {
  try {
    const { address } = req.params;
    const { haulToken } = req.contracts;

    const balance = await haulToken.balanceOf(address);
    const releasable = await haulToken.releasableAmount(address);

    res.json({
      success: true,
      data: {
        address,
        balance: balance.toString(),
        releasableAmount: releasable.toString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/v1/tokens/usdt/balance/:address
 * @desc    Get USDT balance for address
 */
router.get('/usdt/balance/:address', [
  param('address').isEthereumAddress(),
  validate
], async (req, res, next) => {
  try {
    const { address } = req.params;
    
    // USDT standard ERC20 interface
    const usdtAbi = [
      'function balanceOf(address) view returns (uint256)',
      'function decimals() view returns (uint8)',
      'function symbol() view returns (string)'
    ];
    
    const usdt = new (require('ethers')).Contract(
      process.env.USDT_ADDRESS,
      usdtAbi,
      req.provider
    );

    const [balance, decimals, symbol] = await Promise.all([
      usdt.balanceOf(address),
      usdt.decimals(),
      usdt.symbol()
    ]);

    res.json({
      success: true,
      data: {
        address,
        balance: balance.toString(),
        decimals: Number(decimals),
        symbol
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
