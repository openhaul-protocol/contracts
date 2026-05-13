/**
 * OpenHaul Protocol REST API Server
 * 
 * Provides HTTP endpoints for:
 * - Order management (create, query, update)
 * - Reputation queries
 * - Dispute tracking
 * - Contract event streaming
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const { ethers } = require('ethers');

const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const rateLimiter = require('./middleware/rateLimiter');

// Route imports
const orderRoutes = require('./routes/orders');
const reputationRoutes = require('./routes/reputation');
const disputeRoutes = require('./routes/disputes');
const tokenRoutes = require('./routes/tokens');
const healthRoutes = require('./routes/health');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
app.use(rateLimiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// Swagger documentation
const swaggerDocument = YAML.load('./swagger.yaml');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Contract connection
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const contracts = {
  haulToken: new ethers.Contract(
    process.env.HAUL_TOKEN_ADDRESS,
    require('./abis/HAULToken.json'),
    provider
  ),
  orderContract: new ethers.Contract(
    process.env.ORDER_CONTRACT_ADDRESS,
    require('./abis/OrderContract.json'),
    provider
  ),
  reputationContract: new ethers.Contract(
    process.env.REPUTATION_CONTRACT_ADDRESS,
    require('./abis/ReputationContract.json'),
    provider
  ),
  disputeContract: new ethers.Contract(
    process.env.DISPUTE_CONTRACT_ADDRESS,
    require('./abis/DisputeContract.json'),
    provider
  )
};

// Attach contracts to requests
app.use((req, res, next) => {
  req.contracts = contracts;
  req.provider = provider;
  next();
});

// Routes
app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/reputation', reputationRoutes);
app.use('/api/v1/disputes', disputeRoutes);
app.use('/api/v1/tokens', tokenRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'OpenHaul Protocol API',
    version: '1.0.0',
    network: process.env.NETWORK || 'unknown',
    documentation: '/api-docs',
    endpoints: {
      health: '/api/v1/health',
      orders: '/api/v1/orders',
      reputation: '/api/v1/reputation',
      disputes: '/api/v1/disputes',
      tokens: '/api/v1/tokens'
    }
  });
});

// Error handling
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 OpenHaul API server running on port ${PORT}`);
  logger.info(`📚 API Documentation: http://localhost:${PORT}/api-docs`);
  logger.info(`⛓️  Connected to: ${process.env.RPC_URL}`);
});

module.exports = app;
