# OpenHaul Protocol 🚛

> Decentralized logistics marketplace built on Polygon

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.19-blue)](https://soliditylang.org/)
[![Polygon](https://img.shields.io/badge/Polygon-Purple)](https://polygon.technology/)

## Overview

OpenHaul Protocol connects shippers and carriers through trustless smart contracts, featuring:

- **HAUL Token** - Fixed supply ERC-20 with team vesting
- **On-chain Reputation** - Build trust through completed orders and ratings
- **Decentralized Arbitration** - Kleros-inspired juror-based dispute resolution
- **Automatic Settlement** - USDT payments released on delivery confirmation

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Shipper   │────▶│  OrderContract│◀───│   Carrier   │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    ┌────┴────┐      ┌────┴────┐      ┌────┴────┐
    │ HAULToken│      │Reputation│      │ Dispute │
    │ (ERC-20) │      │ Contract │      │ Contract│
    └─────────┘      └─────────┘      └─────────┘
```

See [docs/architecture.md](docs/architecture.md) for detailed specifications.

## Quick Start

### Prerequisites
- Node.js >= 18
- Hardhat

### Installation

```bash
# Clone repository
git clone https://github.com/openhaul-protocol/contracts.git
cd contracts

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test
```

### Deployment

```bash
# Deploy to Mumbai testnet
npm run deploy:mumbai

# Deploy to Polygon mainnet
npm run deploy:polygon
```

## Contracts

| Contract | Description | Key Features |
|----------|-------------|--------------|
| `HAULToken.sol` | Protocol token | Fixed supply, vesting, no ICO |
| `ReputationContract.sol` | On-chain reputation | Score-based tiers, dispute tracking |
| `DisputeContract.sol` | Decentralized arbitration | Juror staking, evidence, appeals |
| `OrderContract.sol` | Order lifecycle | USDT escrow, auto-settlement |

## Tokenomics

| Allocation | Percentage | Vesting |
|------------|-----------|---------|
| Team | 20% | 4-year vesting, 1-year cliff |
| Liquidity | 15% | Immediate |
| Ecosystem | 40% | Immediate |
| Reserve | 25% | Immediate |

**Total Supply:** 100,000,000 HAUL

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

For security concerns, email security@openhaul.xyz

## License

MIT License - see [LICENSE](LICENSE) file.

## Community

- Discord: [https://discord.gg/openhaul](https://discord.gg/openhaul)
- Twitter: [@OpenHaulProtocol](https://twitter.com/OpenHaulProtocol)
