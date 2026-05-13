/**
 * Global Error Handler
 */

const logger = require('../utils/logger');

module.exports = (err, req, res, next) => {
  logger.error(err.stack);

  // Ethers errors
  if (err.code === 'CALL_EXCEPTION') {
    return res.status(400).json({
      success: false,
      error: 'Contract call failed',
      details: err.reason || 'Transaction would revert'
    });
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: err.message
    });
  }

  // Default
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};
