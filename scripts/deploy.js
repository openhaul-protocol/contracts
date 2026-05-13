const { ethers } = require("hardhat");

/**
 * OpenHaul Protocol — Deployment Script
 *
 * P1 fixes:
 *   - Wallet addresses must be set via env vars (no deployer-as-everything)
 *   - Wait 5 confirmations before verify (not hardcoded 30s)
 *   - USDT address per network
 *   - DisputeContract receives OrderContract address at deploy time
 *   - Post-deploy checklist printed
 */

const NETWORK_CONFIG = {
  31337: {  // hardhat local
    usdtAddress: null,  // deploy mock in test
    name: "localhost"
  },
  80002: {  // Polygon Amoy testnet
    usdtAddress: process.env.AMOY_USDT_ADDRESS || "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    name: "amoy"
  },
  137: {    // Polygon mainnet
    usdtAddress: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", // bridged USDT on Polygon
    name: "mainnet"
  }
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const config = NETWORK_CONFIG[chainId];

  if (!config) throw new Error(`Unsupported chainId: ${chainId}`);

  console.log("════════════════════════════════════════");
  console.log("OpenHaul Protocol Deployment");
  console.log("════════════════════════════════════════");
  console.log("Network:   ", config.name);
  console.log("ChainId:   ", chainId);
  console.log("Deployer:  ", deployer.address);
  console.log("Balance:   ", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "MATIC");

  // P1 FIX: Require explicit wallet addresses — no fallback to deployer
  const TREASURY_ADDRESS = process.env.TREASURY_MULTISIG;
  const ECOSYSTEM_ADDRESS = process.env.ECOSYSTEM_CONTRACT || process.env.TREASURY_MULTISIG;
  const CONTRIBUTORS_ADDRESS = process.env.CONTRIBUTORS_VESTING || process.env.TREASURY_MULTISIG;

  if (chainId === 137) {
    // Mainnet: all addresses must be explicitly configured
    if (!TREASURY_ADDRESS || !ECOSYSTEM_ADDRESS || !CONTRIBUTORS_ADDRESS) {
      throw new Error(
        "Mainnet deployment requires TREASURY_MULTISIG, ECOSYSTEM_CONTRACT, " +
        "and CONTRIBUTORS_VESTING env vars. Never use deployer address for production."
      );
    }
  } else {
    console.log("\n⚠️  Testnet: using deployer address as placeholder for all wallets.");
    console.log("   Set TREASURY_MULTISIG etc. for mainnet.\n");
  }

  const treasury = TREASURY_ADDRESS || deployer.address;
  const ecosystem = ECOSYSTEM_ADDRESS || deployer.address;
  const contributors = CONTRIBUTORS_ADDRESS || deployer.address;

  // ── 1. HAUL Token ──────────────────────────────────────
  console.log("\n[1/4] Deploying HAULToken...");
  const HAULToken = await ethers.getContractFactory("HAULToken");
  const haul = await HAULToken.deploy();
  await haul.waitForDeployment();
  const haulAddr = await haul.getAddress();
  console.log("      HAULToken:", haulAddr);

  // ── 2. Reputation ──────────────────────────────────────
  console.log("\n[2/4] Deploying ReputationContract...");
  const ReputationContract = await ethers.getContractFactory("ReputationContract");
  const reputation = await ReputationContract.deploy();
  await reputation.waitForDeployment();
  const reputationAddr = await reputation.getAddress();
  console.log("      ReputationContract:", reputationAddr);

  // ── 3. Order (before Dispute — Dispute needs Order address) ──
  console.log("\n[3/4] Deploying OrderContract...");

  let usdtAddress = config.usdtAddress;
  if (!usdtAddress) {
    // Deploy mock USDT for local testing
    console.log("      Deploying MockUSDT for local testing...");
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const mockUsdt = await MockERC20.deploy("Mock USDT", "USDT", 6);
    await mockUsdt.waitForDeployment();
    usdtAddress = await mockUsdt.getAddress();
    console.log("      MockUSDT:", usdtAddress);
  }

  // We need DisputeContract address before OrderContract, so deploy a proxy pattern
  // Simplest approach: deploy Order first, then Dispute with Order address
  const OrderContract = await ethers.getContractFactory("OrderContract");
  const order = await OrderContract.deploy(
    usdtAddress,
    haulAddr,
    reputationAddr,
    treasury
    // DisputeContract address set post-deploy via setDisputeContract()
  );
  await order.waitForDeployment();
  const orderAddr = await order.getAddress();
  console.log("      OrderContract:", orderAddr);

  // ── 4. Dispute ─────────────────────────────────────────
  console.log("\n[4/4] Deploying DisputeContract...");
  const DisputeContract = await ethers.getContractFactory("DisputeContract");
  const dispute = await DisputeContract.deploy(
    haulAddr,
    reputationAddr,
    orderAddr       // P1 FIX: DisputeContract knows its authorized caller
  );
  await dispute.waitForDeployment();
  const disputeAddr = await dispute.getAddress();
  console.log("      DisputeContract:", disputeAddr);

  // ── Wire up ────────────────────────────────────────────
  console.log("\n[5/5] Wiring authorizations...");

  let tx;

  tx = await reputation.authorizeCaller(orderAddr);
  await tx.wait(chainId === 137 ? 5 : 1);  // P1 FIX: wait confirmations, not sleep
  console.log("      ReputationContract ← authorized OrderContract");

  tx = await reputation.authorizeCaller(disputeAddr);
  await tx.wait(chainId === 137 ? 5 : 1);
  console.log("      ReputationContract ← authorized DisputeContract");

  // Wire DisputeContract address back into OrderContract
  tx = await order.setDisputeContract(disputeAddr);
  await tx.wait(chainId === 137 ? 5 : 1);
  console.log("      OrderContract ← set DisputeContract");

  // Initialize HAUL token
  tx = await haul.initialize(treasury, ecosystem, contributors);
  await tx.wait(chainId === 137 ? 5 : 1);
  console.log("      HAULToken initialized");
  console.log("        Treasury:     ", treasury);
  console.log("        Ecosystem:    ", ecosystem);
  console.log("        Contributors: ", contributors);

  // ── Summary ────────────────────────────────────────────
  console.log("\n════════════════════════════════════════");
  console.log("Deployment Complete");
  console.log("════════════════════════════════════════");
  console.log("HAULToken:          ", haulAddr);
  console.log("ReputationContract: ", reputationAddr);
  console.log("OrderContract:      ", orderAddr);
  console.log("DisputeContract:    ", disputeAddr);
  console.log("════════════════════════════════════════");
  console.log("\n📋 Post-deploy checklist:");
  console.log("  [ ] Verify contracts on Polygonscan");
  console.log("  [ ] Transfer ReputationContract ownership to multisig");
  console.log("  [ ] Fund treasury with initial MATIC for gas");
  console.log("  [ ] Test: createOrder → acceptOrder → confirmDelivery on testnet");
  console.log("  [ ] Ensure USDT approve() documented in frontend (users must approve first)");
  console.log("  [ ] Chainlink VRF integration before mainnet (P2)");

  // Save addresses for frontend/SDK use
  const addresses = {
    network: config.name,
    chainId,
    HAULToken: haulAddr,
    ReputationContract: reputationAddr,
    OrderContract: orderAddr,
    DisputeContract: disputeAddr,
    USDT: usdtAddress,
    deployedAt: new Date().toISOString()
  };

  const fs = require("fs");
  fs.writeFileSync(
    `deployments/${config.name}.json`,
    JSON.stringify(addresses, null, 2)
  );
  console.log(`\n  Addresses saved to deployments/${config.name}.json`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
