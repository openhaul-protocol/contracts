# OpenHaul Protocol — Audit Findings & Fixes

> Status: v0.1 → v0.2 patch
> Audited by: community review (pre-formal-audit)

---

## P0 — Critical (Blocking)

### ✅ FIXED: Dispute fee unit mismatch
**File:** `DisputeContract.sol`
**Issue:** `DISPUTE_FEE = 50 * 10**18` treated as `msg.value` (MATIC), but
`OrderContract.raiseDispute()` passed `value: 0`. Disputes were impossible to create.
**Fix:** Fee is now `DISPUTE_FEE_HAUL = 10e18` HAUL ERC-20 tokens.
`createDispute()` calls `haul.transferFrom(raisedBy, address(this), DISPUTE_FEE_HAUL)`.
No native token required.

### ✅ FIXED: commit-reveal with no actual commitment stored
**File:** `DisputeContract.sol`
**Issue:** `commitVote()` only set `committed = true` without storing the hash.
`revealVote()` commented "Verify commitment (simplified)" but did no verification.
Jurors could change their vote in the reveal phase.
**Fix:** Removed commit-reveal entirely. Direct voting within `VOTING_PERIOD`.
Simpler, auditable, no attack vector.

### ✅ FIXED: Juror staking was a stub
**File:** `DisputeContract.sol`
**Issue:** `stakeAsJuror()` had comment "In production, transfer HAUL tokens here" —
no actual transfer. Anyone could become a juror for free.
**Fix:** `registerAsJuror()` now calls `haul.transferFrom(msg.sender, address(this), JUROR_STAKE_HAUL)`.

### ✅ FIXED: Anyone could create disputes directly
**File:** `DisputeContract.sol`
**Issue:** `createDispute()` had no access control. Anyone could create disputes
unrelated to real orders, bypassing OrderContract state checks.
**Fix:** `onlyOrderContract` modifier. Only `OrderContract` can call `createDispute()`.

---

## P1 — High

### ✅ FIXED: hasRated blocked re-rating across orders
**File:** `ReputationContract.sol`
**Issue:** `hasRated[rater][ratee]` was address-pair scoped. After one rating,
a merchant could never rate the same driver again on any future order.
**Fix:** Changed to `hasRated[orderId][rater]` — per-order scoping.

### ✅ FIXED: Weight constants unused
**File:** `ReputationContract.sol`
**Issue:** `COMPLETION_WEIGHT`, `RATING_WEIGHT`, etc. were defined but the
`_updateScore()` function used hardcoded `+10 / -5` values instead.
**Fix:** `getCompositeScore()` now applies all weights via BPS calculation.

### ✅ FIXED: getTenureBonus() never applied
**File:** `ReputationContract.sol`
**Issue:** Tenure bonus was calculated but never included in score output.
**Fix:** `_getTenureBonus()` is now added to `getCompositeScore()` return value.

### ✅ FIXED: Amoy testnet (Mumbai deprecated)
**File:** `hardhat.config.js`
**Issue:** Config referenced Mumbai RPC. Mumbai was shut down 2024-04-08.
**Fix:** Replaced with Polygon Amoy (chainId: 80002).

### ✅ FIXED: All wallets defaulted to deployer
**File:** `scripts/deploy.js`
**Issue:** Treasury, ecosystem, and contributor allocations all went to `deployer.address`.
On mainnet this would put 100M HAUL under a single hot wallet.
**Fix:** Requires `TREASURY_MULTISIG`, `ECOSYSTEM_CONTRACT`, `CONTRIBUTORS_VESTING`
env vars on mainnet. Throws if not set.

---

## P2 — Medium (Planned)

### ⏳ TODO: Chainlink VRF for jury selection
**File:** `DisputeContract.sol`
**Issue:** `block.timestamp + block.prevrandao` is manipulable by Polygon validators.
**Plan:** Integrate `VRFConsumerBaseV2` before mainnet with significant value at stake.
**Current:** Documented with `// TODO P2` comment. Acceptable for testnet.

### ⏳ TODO: Multi-beneficiary vesting
**File:** `HAULToken.sol`
**Issue:** Single `teamWallet` for all contributor allocation.
**Plan:** Replace with OpenZeppelin `VestingWallet` clones per contributor,
or deploy a `VestingScheduler` contract.

### ⏳ TODO: circulatingSupply() accuracy
**File:** `HAULToken.sol`
**Issue:** `locked` hardcoded to 0; returns `totalSupply()`.
**Plan:** Implement once vesting contract is deployed; query locked amounts
from vesting contracts and subtract.

---

## Remaining Known Issues

| Issue | Severity | Notes |
|-------|----------|-------|
| No Sybil protection on `register()` | Low | Initial 100 score can be farmed with multiple wallets. Mitigation: require min HAUL stake to register (P2) |
| `HAULToken` constructor self-transfer | Low | `_transfer(address(this), address(this), teamAmount)` wastes gas, no functional impact. Remove in next cleanup. |
| Re-entrancy on `_settleOrder` | Low | Internal function, USDT on Polygon has no callback hooks. Guard added to public callers. Monitor if settlement path changes. |

---

## Formal Audit

A third-party security audit is required before mainnet deployment.
Recommended firms for Polygon/EVM contracts: Trail of Bits, Zellic, Spearbit.

Estimated timeline: 2–4 weeks, $30k–$80k depending on scope.
Budget line item in DAO treasury allocation.
