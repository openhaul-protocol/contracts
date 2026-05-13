/**
 * Dispute Routes
 * Query dispute information
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
 * @route   GET /api/v1/disputes/:disputeId
 * @desc    Get dispute details
 */
router.get('/:disputeId', [
  param('disputeId').isInt({ min: 0 }),
  validate
], async (req, res, next) => {
  try {
    const { disputeId } = req.params;
    const { disputeContract } = req.contracts;

    const dispute = await disputeContract.getDispute(disputeId);

    const statusMap = ['None', 'Evidence', 'Voting', 'Appeatable', 'Resolved', 'Executed'];
    const rulingMap = ['RefusedToRule', 'ShippingPartyWins', 'CarryingPartyWins'];

    res.json({
      success: true,
      data: {
        disputeId: Number(dispute.disputeId),
        orderId: Number(dispute.orderId),
        initiator: dispute.initiator,
        respondent: dispute.respondent,
        reason: dispute.reason,
        status: statusMap[dispute.state] || 'Unknown',
        finalRuling: rulingMap[dispute.finalRuling] || 'Unknown',
        shippingPartyVotes: Number(dispute.shippingPartyVotes),
        carryingPartyVotes: Number(dispute.carryingPartyVotes),
        totalJurors: Number(dispute.totalJurors),
        amountAtStake: dispute.amountAtStake.toString(),
        appealUsed: dispute.appealUsed,
        evidenceDeadline: new Date(Number(dispute.evidenceDeadline) * 1000).toISOString(),
        votingDeadline: dispute.votingDeadline > 0 ? new Date(Number(dispute.votingDeadline) * 1000).toISOString() : null,
        appealDeadline: dispute.appealDeadline > 0 ? new Date(Number(dispute.appealDeadline) * 1000).toISOString() : null
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/v1/disputes/order/:orderId
 * @desc    Get dispute by order ID
 */
router.get('/order/:orderId', [
  param('orderId').isInt({ min: 0 }),
  validate
], async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { orderContract } = req.contracts;

    const disputeId = await orderContract.disputeIdByOrder(orderId);

    if (disputeId === 0n) {
      return res.status(404).json({
        success: false,
        error: 'No dispute found for this order'
      });
    }

    res.json({
      success: true,
      data: { orderId: Number(orderId), disputeId: Number(disputeId) }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
