/**
 * Reputation Routes
 * Query reputation scores and stats
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
 * @route   GET /api/v1/reputation/:address
 * @desc    Get reputation for an address
 */
router.get('/:address', [
  param('address').isEthereumAddress(),
  validate
], async (req, res, next) => {
  try {
    const { address } = req.params;
    const { reputationContract } = req.contracts;

    const [reputation, score, tier] = await Promise.all([
      reputationContract.getReputation(address),
      reputationContract.getScore(address),
      reputationContract.getTier(address)
    ]);

    res.json({
      success: true,
      data: {
        address,
        score: Number(score),
        tier,
        completedOrders: Number(reputation.completedOrders),
        totalRatings: Number(reputation.totalRatings),
        positiveRatings: Number(reputation.positiveRatings),
        negativeRatings: Number(reputation.negativeRatings),
        disputesWon: Number(reputation.disputesWon),
        disputesLost: Number(reputation.disputesLost),
        registrationTime: new Date(Number(reputation.registrationTime) * 1000).toISOString(),
        isRegistered: reputation.isRegistered
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/v1/reputation/:address/score
 * @desc    Get just the score
 */
router.get('/:address/score', [
  param('address').isEthereumAddress(),
  validate
], async (req, res, next) => {
  try {
    const { address } = req.params;
    const { reputationContract } = req.contracts;

    const score = await reputationContract.getScore(address);

    res.json({
      success: true,
      data: { address, score: Number(score) }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/v1/reputation/:address/tier
 * @desc    Get reputation tier
 */
router.get('/:address/tier', [
  param('address').isEthereumAddress(),
  validate
], async (req, res, next) => {
  try {
    const { address } = req.params;
    const { reputationContract } = req.contracts;

    const [tier, score] = await Promise.all([
      reputationContract.getTier(address),
      reputationContract.getScore(address)
    ]);

    res.json({
      success: true,
      data: { address, tier, score: Number(score) }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
