/**
 * Order Routes
 * CRUD operations for logistics orders
 */

const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const orderController = require('../controllers/orderController');

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/**
 * @route   GET /api/v1/orders
 * @desc    List all orders with pagination
 * @query   {number} page - Page number (default: 1)
 * @query   {number} limit - Items per page (default: 20)
 * @query   {string} status - Filter by status
 * @query   {string} shipper - Filter by shipper address
 * @query   {string} carrier - Filter by carrier address
 */
router.get('/', [
  body('page').optional().isInt({ min: 1 }),
  body('limit').optional().isInt({ min: 1, max: 100 }),
  body('status').optional().isIn(['Created', 'Accepted', 'InTransit', 'Delivered', 'Confirmed', 'Disputed', 'Resolved', 'Cancelled', 'Completed']),
  validate
], orderController.listOrders);

/**
 * @route   GET /api/v1/orders/:orderId
 * @desc    Get order details by ID
 */
router.get('/:orderId', [
  param('orderId').isInt({ min: 0 }),
  validate
], orderController.getOrder);

/**
 * @route   GET /api/v1/orders/shipper/:address
 * @desc    Get orders by shipper address
 */
router.get('/shipper/:address', [
  param('address').isEthereumAddress(),
  validate
], orderController.getShipperOrders);

/**
 * @route   GET /api/v1/orders/carrier/:address
 * @desc    Get orders by carrier address
 */
router.get('/carrier/:address', [
  param('address').isEthereumAddress(),
  validate
], orderController.getCarrierOrders);

/**
 * @route   POST /api/v1/orders
 * @desc    Create a new order (requires wallet signature)
 * @body    {string} pickupLocation - Pickup location
 * @body    {string} deliveryLocation - Delivery location
 * @body    {string} cargoDetails - Cargo description
 * @body    {number} cargoValue - Cargo value in USD
 * @body    {number} shippingFee - Shipping fee in USDT
 * @body    {string} shipperAddress - Shipper wallet address
 */
router.post('/', [
  body('pickupLocation').isString().trim().isLength({ min: 1, max: 200 }),
  body('deliveryLocation').isString().trim().isLength({ min: 1, max: 200 }),
  body('cargoDetails').isString().trim().isLength({ min: 1, max: 500 }),
  body('cargoValue').isFloat({ min: 0 }),
  body('shippingFee').isFloat({ min: 0 }),
  body('shipperAddress').isEthereumAddress(),
  validate
], orderController.createOrder);

/**
 * @route   POST /api/v1/orders/:orderId/accept
 * @desc    Carrier accepts an order
 */
router.post('/:orderId/accept', [
  param('orderId').isInt({ min: 0 }),
  body('carrierAddress').isEthereumAddress(),
  validate
], orderController.acceptOrder);

/**
 * @route   POST /api/v1/orders/:orderId/transit
 * @desc    Mark order as in transit
 */
router.post('/:orderId/transit', [
  param('orderId').isInt({ min: 0 }),
  body('carrierAddress').isEthereumAddress(),
  validate
], orderController.startTransit);

/**
 * @route   POST /api/v1/orders/:orderId/deliver
 * @desc    Mark order as delivered
 */
router.post('/:orderId/deliver', [
  param('orderId').isInt({ min: 0 }),
  body('carrierAddress').isEthereumAddress(),
  validate
], orderController.markDelivered);

/**
 * @route   POST /api/v1/orders/:orderId/confirm
 * @desc    Shipper confirms delivery
 */
router.post('/:orderId/confirm', [
  param('orderId').isInt({ min: 0 }),
  body('shipperAddress').isEthereumAddress(),
  validate
], orderController.confirmDelivery);

/**
 * @route   POST /api/v1/orders/:orderId/dispute
 * @desc    Raise a dispute
 */
router.post('/:orderId/dispute', [
  param('orderId').isInt({ min: 0 }),
  body('reason').isString().trim().isLength({ min: 10, max: 1000 }),
  body('initiatorAddress').isEthereumAddress(),
  validate
], orderController.raiseDispute);

/**
 * @route   POST /api/v1/orders/:orderId/rate
 * @desc    Rate counterparty
 */
router.post('/:orderId/rate', [
  param('orderId').isInt({ min: 0 }),
  body('isPositive').isBoolean(),
  body('raterAddress').isEthereumAddress(),
  validate
], orderController.rateCounterparty);

module.exports = router;
