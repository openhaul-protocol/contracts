/**
 * Rate Limiter Middleware
 */

const { RateLimiterMemory } = require('rate-limiter-flexible');

const rateLimiter = new RateLimiterMemory({
  keyPrefix: 'openhaul_api',
  points: 100, // 100 requests
  duration: 60 // per minute
});

module.exports = async (req, res, next) => {
  try {
    await rateLimiter.consume(req.ip);
    next();
  } catch {
    res.status(429).json({
      success: false,
      error: 'Too many requests, please try again later'
    });
  }
};
