# OpenHaul Protocol Architecture

## Overview

OpenHaul is a decentralized logistics marketplace built on Polygon. It connects shippers and carriers through smart contracts, with on-chain reputation, decentralized dispute resolution, and automatic USDT settlement.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        OpenHaul Protocol                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Shipper    │  │   Carrier    │  │    Juror     │      │
│  │    (dApp)    │  │    (dApp)    │  │   (dApp)     │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                 │               │
│         └─────────────────┼─────────────────┘               │
│                           │                                  │
│                    ┌──────┴──────┐                          │
│                    │  OrderContract │  ← Order lifecycle      │
│                    │   (Core)      │    + USDT settlement    │
│                    └──────┬──────┘                          │
│                           │                                  │
│         ┌─────────────────┼─────────────────┐               │
│         │                 │                 │               │
│    ┌────┴────┐      ┌────┴────┐      ┌────┴────┐          │
│    │ HAULToken│      │Reputation│      │ Dispute │          │
│    │ (ERC-20) │      │ Contract │      │ Contract│          │
│    │          │      │          │      │         │          │
│    │ • Fixed  │      │ • On-chain│      │ • Kleros│          │
│    │   supply │      │   score  │      │   style │          │
│    │ • Vesting│      │ • Ratings│      │ • Juror │          │
│    │ • No ICO │      │ • Dispute│      │   stake │          │
│    └─────────┘      └─────────┘      └─────────┘          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              USDT (Polygon ERC-20)                    │  │
│  │         Automatic settlement on delivery              │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Contract Interactions

```
┌─────────────┐     createOrder()      ┌─────────────┐
│   Shipper   │ ─────────────────────> │OrderContract│
│             │     USDT escrowed      │             │
└─────────────┘                        └──────┬──────┘
                                              │
                                              │ acceptOrder()
                                              │ USDT collateral
                                              ▼
┌─────────────┐     startTransit()     ┌─────────────┐
│   Carrier   │ ─────────────────────> │OrderContract│
│             │                        │             │
└─────────────┘                        └──────┬──────┘
                                              │
                                              │ markDelivered()
                                              ▼
┌─────────────┐     confirmDelivery()  ┌─────────────┐     ┌─────────────┐
│   Shipper   │ ─────────────────────> │OrderContract│────>│   USDT      │
│             │                        │  auto-settle│     │  payout     │
└─────────────┘                        └─────────────┘     └─────────────┘
                                              │
                                              │ raiseDispute()
                                              ▼
                                       ┌─────────────┐
                                       │DisputeContract│
                                       │  • Evidence   │
                                       │  • Juror vote │
                                       │  • Appeal     │
                                       └──────┬──────┘
                                              │
                                              │ recordDisputeOutcome()
                                              ▼
                                       ┌─────────────┐
                                       │ Reputation  │
                                       │  Contract   │
                                       └─────────────┘
```

## Contract Specifications

### HAULToken.sol

| Function | Description | Access |
|----------|-------------|--------|
| `constructor(team, liquidity, ecosystem, reserve)` | Deploy with 4 wallet allocations | Deployer |
| `releasableAmount(beneficiary)` | Calculate vested tokens | Public |
| `releaseVestedTokens()` | Claim vested team tokens | Team wallet |
| `burn(amount)` | Burn caller's tokens | Any |
| `circulatingSupply()` | Get circulating supply | Public |

**Tokenomics:**
- Total Supply: 100,000,000 HAUL
- Team: 20% (4-year vesting, 1-year cliff)
- Liquidity: 15% (immediate)
- Ecosystem: 40% (immediate)
- Reserve: 25% (immediate)

### ReputationContract.sol

| Function | Description | Access |
|----------|-------------|--------|
| `register()` | Join reputation system | Any |
| `authorizeUpdater(updater)` | Allow contract to update | Owner |
| `recordCompletion(user)` | +5 pts for completed order | Authorized |
| `submitRating(ratee, isPositive, orderId)` | Rate counterparty | Registered |
| `recordDisputeOutcome(user, won, noFault)` | Update after dispute | Authorized |
| `getScore(user)` | Get reputation score | Public |
| `getTier(user)` | Get tier (New→Diamond) | Public |
| `meetsThreshold(user, min)` | Check min score | Public |

**Score System:**
- Base: 100
- Max: 1000
- Completion: +5
- Positive rating: +10
- Negative rating: -15
- Dispute won: +15
- Dispute lost: -25

**Tiers:**
- 900+: Diamond
- 700+: Platinum
- 500+: Gold
- 300+: Silver
- 100+: Bronze
- <100: New

### DisputeContract.sol

| Function | Description | Access |
|----------|-------------|--------|
| `stakeAsJuror()` | Stake 100 HAUL to become juror | Any |
| `unstakeAsJuror()` | Exit and reclaim stake | Juror |
| `createDispute(orderId, respondent, reason, amount)` | Start dispute | Any (fee: 50 HAUL) |
| `submitEvidence(disputeId, evidenceURI)` | Submit evidence | Parties |
| `startVoting(disputeId)` | Begin voting phase | Any |
| `commitVote(disputeId, commitment)` | Hidden vote | Assigned juror |
| `revealVote(disputeId, choice, salt)` | Reveal vote | Assigned juror |
| `resolveDispute(disputeId)` | Tally votes | Any |
| `appeal(disputeId)` | One-time appeal | Party (2x fee) |
| `executeRuling(disputeId)` | Finalize and update rep | Any |

**Timeline:**
- Evidence: 3 days
- Voting: 7 days
- Appeal: 2 days

### OrderContract.sol

| Function | Description | Access |
|----------|-------------|--------|
| `createOrder(pickup, delivery, cargo, value, fee)` | Create order | Shipper |
| `acceptOrder(orderId)` | Accept with collateral | Carrier |
| `startTransit(orderId)` | Mark in transit | Carrier |
| `markDelivered(orderId)` | Mark delivered | Carrier |
| `confirmDelivery(orderId)` | Confirm & settle | Shipper |
| `autoConfirm(orderId)` | Auto-settle after 3 days | Any |
| `cancelOrder(orderId)` | Cancel before acceptance | Shipper |
| `raiseDispute(orderId, reason)` | Start dispute | Party |
| `executeDisputeRuling(orderId)` | Execute dispute result | Any |
| `rateCounterparty(orderId, isPositive)` | Rate after completion | Party |

**Fees:**
- Platform fee: 2.5%
- Carrier collateral: 50% of fee

**Timeouts:**
- Acceptance: 24 hours
- Delivery: 7 days
- Confirmation: 3 days

## Deployment Order

```
1. HAULToken
   └── Inputs: 4 wallet addresses
   
2. ReputationContract
   └── No dependencies
   
3. DisputeContract
   └── Depends on: ReputationContract
   
4. OrderContract
   └── Depends on: USDT, ReputationContract, DisputeContract, Treasury
   
5. Authorizations
   └── OrderContract → ReputationContract (authorizeUpdater)
   └── DisputeContract → ReputationContract (authorizeUpdater)
```

## Security Considerations

1. **ReentrancyGuard** on all external payable functions
2. **Access control** via Ownable and custom modifiers
3. **Bounds checking** on all score updates
4. **Timeout mechanisms** prevent indefinite locks
5. **Appeal system** allows one challenge per dispute
6. **Collateral requirements** align carrier incentives

## Gas Optimization

- Optimizer enabled (200 runs)
- Storage packing for structs
- Batch operations where possible
- Minimal external calls

## Future Enhancements

- [ ] Chainlink VRF for juror selection
- [ ] Multi-token support (USDC, DAI)
- [ ] Insurance pool integration
- [ ] Cross-chain bridges
- [ ] DAO governance transition
