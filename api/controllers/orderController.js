/**
 * Order Controller
 * Business logic for order operations
 */

const logger = require('../utils/logger');

class OrderController {
  /**
   * List orders with pagination and filters
   */
  async listOrders(req, res, next) {
    try {
      const { 
        page = 1, 
        limit = 20, 
        status,
        shipper,
        carrier 
      } = req.query;

      const { orderContract } = req.contracts;
      
      // Get total order count
      const totalOrders = await orderContract.nextOrderId();
      
      // Calculate pagination
      const start = (page - 1) * limit;
      const end = Math.min(start + limit, Number(totalOrders));
      
      // Fetch orders
      const orders = [];
      for (let i = start; i < end; i++) {
        try {
          const order = await orderContract.getOrder(i);
          
          // Apply filters
          if (status && order.status.toString() !== status) continue;
          if (shipper && order.shipper.toLowerCase() !== shipper.toLowerCase()) continue;
          if (carrier && order.carrier.toLowerCase() !== carrier.toLowerCase()) continue;
          
          orders.push(this._formatOrder(order, i));
        } catch (err) {
          logger.warn(`Failed to fetch order ${i}: ${err.message}`);
        }
      }

      res.json({
        success: true,
        data: orders,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: Number(totalOrders),
          totalPages: Math.ceil(Number(totalOrders) / limit)
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get single order details
   */
  async getOrder(req, res, next) {
    try {
      const { orderId } = req.params;
      const { orderContract } = req.contracts;

      const order = await orderContract.getOrder(orderId);
      
      if (order.shipper === '0x0000000000000000000000000000000000000000') {
        return res.status(404).json({
          success: false,
          error: 'Order not found'
        });
      }

      res.json({
        success: true,
        data: this._formatOrder(order, orderId)
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get orders by shipper address
   */
  async getShipperOrders(req, res, next) {
    try {
      const { address } = req.params;
      const { orderContract } = req.contracts;

      const orderIds = await orderContract.getShipperOrders(address);
      const orders = await Promise.all(
        orderIds.map(async (id) => {
          const order = await orderContract.getOrder(id);
          return this._formatOrder(order, id);
        })
      );

      res.json({
        success: true,
        data: orders,
        count: orders.length
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get orders by carrier address
   */
  async getCarrierOrders(req, res, next) {
    try {
      const { address } = req.params;
      const { orderContract } = req.contracts;

      const orderIds = await orderContract.getCarrierOrders(address);
      const orders = await Promise.all(
        orderIds.map(async (id) => {
          const order = await orderContract.getOrder(id);
          return this._formatOrder(order, id);
        })
      );

      res.json({
        success: true,
        data: orders,
        count: orders.length
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create a new order
   * Note: This prepares the transaction data for frontend signing
   */
  async createOrder(req, res, next) {
    try {
      const {
        pickupLocation,
        deliveryLocation,
        cargoDetails,
        cargoValue,
        shippingFee,
        shipperAddress
      } = req.body;

      const { orderContract } = req.contracts;

      // Encode transaction data for frontend signing
      const txData = orderContract.interface.encodeFunctionData('createOrder', [
        pickupLocation,
        deliveryLocation,
        cargoDetails,
        ethers.parseUnits(cargoValue.toString(), 6), // USDT has 6 decimals
        ethers.parseUnits(shippingFee.toString(), 6)
      ]);

      logger.info(`Order creation prepared for ${shipperAddress}`);

      res.json({
        success: true,
        data: {
          to: await orderContract.getAddress(),
          from: shipperAddress,
          data: txData,
          value: '0',
          // Frontend needs to also call usdt.approve() before this
          approvalNeeded: true,
          approvalToken: process.env.USDT_ADDRESS,
          approvalSpender: await orderContract.getAddress(),
          approvalAmount: ethers.parseUnits(
            (shippingFee * 1.5).toString(), // fee + collateral buffer
            6
          ).toString()
        },
        message: 'Transaction prepared. Please sign with your wallet after approving USDT.'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Accept order (carrier)
   */
  async acceptOrder(req, res, next) {
    try {
      const { orderId } = req.params;
      const { carrierAddress } = req.body;
      const { orderContract } = req.contracts;

      const txData = orderContract.interface.encodeFunctionData('acceptOrder', [orderId]);

      res.json({
        success: true,
        data: {
          to: await orderContract.getAddress(),
          from: carrierAddress,
          data: txData,
          approvalNeeded: true,
          approvalToken: process.env.USDT_ADDRESS,
          approvalSpender: await orderContract.getAddress()
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Start transit
   */
  async startTransit(req, res, next) {
    try {
      const { orderId } = req.params;
      const { carrierAddress } = req.body;
      const { orderContract } = req.contracts;

      const txData = orderContract.interface.encodeFunctionData('startTransit', [orderId]);

      res.json({
        success: true,
        data: {
          to: await orderContract.getAddress(),
          from: carrierAddress,
          data: txData
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark delivered
   */
  async markDelivered(req, res, next) {
    try {
      const { orderId } = req.params;
      const { carrierAddress } = req.body;
      const { orderContract } = req.contracts;

      const txData = orderContract.interface.encodeFunctionData('markDelivered', [orderId]);

      res.json({
        success: true,
        data: {
          to: await orderContract.getAddress(),
          from: carrierAddress,
          data: txData
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Confirm delivery
   */
  async confirmDelivery(req, res, next) {
    try {
      const { orderId } = req.params;
      const { shipperAddress } = req.body;
      const { orderContract } = req.contracts;

      const txData = orderContract.interface.encodeFunctionData('confirmDelivery', [orderId]);

      res.json({
        success: true,
        data: {
          to: await orderContract.getAddress(),
          from: shipperAddress,
          data: txData
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Raise dispute
   */
  async raiseDispute(req, res, next) {
    try {
      const { orderId } = req.params;
      const { reason, initiatorAddress } = req.body;
      const { orderContract } = req.contracts;

      const txData = orderContract.interface.encodeFunctionData('raiseDispute', [
        orderId,
        reason
      ]);

      res.json({
        success: true,
        data: {
          to: await orderContract.getAddress(),
          from: initiatorAddress,
          data: txData,
          approvalNeeded: true,
          approvalToken: process.env.HAUL_TOKEN_ADDRESS,
          approvalSpender: await orderContract.getAddress()
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Rate counterparty
   */
  async rateCounterparty(req, res, next) {
    try {
      const { orderId } = req.params;
      const { isPositive, raterAddress } = req.body;
      const { orderContract } = req.contracts;

      const txData = orderContract.interface.encodeFunctionData('rateCounterparty', [
        orderId,
        isPositive
      ]);

      res.json({
        success: true,
        data: {
          to: await orderContract.getAddress(),
          from: raterAddress,
          data: txData
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Format order data for response
   */
  _formatOrder(order, orderId) {
    const statusMap = [
      'None', 'Created', 'Accepted', 'InTransit', 'Delivered', 
      'Confirmed', 'Disputed', 'Resolved', 'Cancelled', 'Completed'
    ];

    return {
      orderId: Number(orderId),
      shipper: order.shipper,
      carrier: order.carrier,
      pickupLocation: order.pickupLocation,
      deliveryLocation: order.deliveryLocation,
      cargoDetails: order.cargoDetails,
      cargoValue: order.cargoValue.toString(),
      shippingFee: order.shippingFee.toString(),
      collateral: order.collateral.toString(),
      status: statusMap[order.status] || 'Unknown',
      statusCode: Number(order.status),
      createdAt: new Date(Number(order.createdAt) * 1000).toISOString(),
      acceptedAt: order.acceptedAt > 0 ? new Date(Number(order.acceptedAt) * 1000).toISOString() : null,
      deliveredAt: order.deliveredAt > 0 ? new Date(Number(order.deliveredAt) * 1000).toISOString() : null,
      confirmedAt: order.confirmedAt > 0 ? new Date(Number(order.confirmedAt) * 1000).toISOString() : null,
      shipperRated: order.shipperRated,
      carrierRated: order.carrierRated
    };
  }
}

module.exports = new OrderController();
