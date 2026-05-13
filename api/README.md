# OpenHaul Protocol API

REST API for OpenHaul Protocol - Decentralized Logistics Marketplace on Polygon.

## Features

- 📦 **Order Management** - Query orders, prepare transactions
- ⭐ **Reputation System** - Check scores and tiers
- ⚖️ **Dispute Tracking** - Monitor arbitration status
- 💰 **Token Balances** - HAUL and USDT balances
- 🔒 **Security** - Rate limiting, input validation, helmet
- 📚 **Documentation** - Swagger UI at `/api-docs`

## Quick Start

```bash
cd api
npm install
cp .env.example .env
# Edit .env with your contract addresses
npm start
```

## API Endpoints

### Health
```
GET /api/v1/health
```

### Orders
```
GET    /api/v1/orders                    # List orders
POST   /api/v1/orders                    # Create order (prepares tx)
GET    /api/v1/orders/:orderId           # Get order details
GET    /api/v1/orders/shipper/:address   # Get shipper's orders
GET    /api/v1/orders/carrier/:address   # Get carrier's orders
POST   /api/v1/orders/:orderId/accept    # Accept order
POST   /api/v1/orders/:orderId/transit   # Start transit
POST   /api/v1/orders/:orderId/deliver   # Mark delivered
POST   /api/v1/orders/:orderId/confirm   # Confirm delivery
POST   /api/v1/orders/:orderId/dispute   # Raise dispute
POST   /api/v1/orders/:orderId/rate      # Rate counterparty
```

### Reputation
```
GET /api/v1/reputation/:address         # Full reputation
GET /api/v1/reputation/:address/score   # Just score
GET /api/v1/reputation/:address/tier    # Just tier
```

### Disputes
```
GET /api/v1/disputes/:disputeId         # Dispute details
GET /api/v1/disputes/order/:orderId     # Dispute by order
```

### Tokens
```
GET /api/v1/tokens/haul/info            # HAUL token info
GET /api/v1/tokens/haul/balance/:addr   # HAUL balance
GET /api/v1/tokens/usdt/balance/:addr   # USDT balance
```

## Architecture

```
Frontend (MetaMask) → API → Polygon Blockchain
                           ↓
                    Contract ABIs
                           ↓
              HAULToken / OrderContract / ReputationContract / DisputeContract
```

**Note:** This API is read-only + transaction preparation. No private keys are stored.

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `RPC_URL` | Polygon RPC | `https://rpc-amoy.polygon.technology` |
| `HAUL_TOKEN_ADDRESS` | HAUL contract | `0x...` |
| `ORDER_CONTRACT_ADDRESS` | Order contract | `0x...` |
| `REPUTATION_CONTRACT_ADDRESS` | Reputation contract | `0x...` |
| `DISPUTE_CONTRACT_ADDRESS` | Dispute contract | `0x...` |
| `USDT_ADDRESS` | USDT contract | `0x...` |

## Documentation

Visit `http://localhost:3000/api-docs` for interactive Swagger UI.

## License

MIT
