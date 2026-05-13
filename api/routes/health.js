/**
 * Health Check Routes
 */

const express = require('express');
const router = express.Router();

/**
 * @route   GET /api/v1/health
 * @desc    API health check
 */
router.get('/', async (req, res) => {
  try {
    const { provider } = req;
    
    // Check blockchain connection
    const blockNumber = await provider.getBlockNumber();
    const network = await provider.getNetwork();

    res.json({
      success: true,
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        blockchain: {
          connected: true,
          blockNumber,
          chainId: Number(network.chainId),
          name: network.name
        },
        contracts: {
          haulToken: process.env.HAUL_TOKEN_ADDRESS ? 'configured' : 'missing',
          orderContract: process.env.ORDER_CONTRACT_ADDRESS ? 'configured' : 'missing',
          reputationContract: process.env.REPUTATION_CONTRACT_ADDRESS ? 'configured' : 'missing',
          disputeContract: process.env.DISPUTE_CONTRACT_ADDRESS ? 'configured' : 'missing'
        }
      }
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      error: 'Service unhealthy',
      details: error.message
    });
  }
});

module.exports = router;
