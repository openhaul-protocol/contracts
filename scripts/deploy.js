const hre = require("hardhat");
const fs = require('fs');
const path = require('path');

/**
 * @title OpenHaul Protocol Deployment Script
 * @dev Deploys all contracts in correct dependency order:
 * 1. HAULToken (ERC-20)
 * 2. ReputationContract
 * 3. DisputeContract (depends on ReputationContract)
 * 4. OrderContract (depends on all above + USDT)
 */

async function main() {
    console.log("🚀 Starting OpenHaul Protocol Deployment...\n");
    
    const [deployer] = await hre.ethers.getSigners();
    console.log(`Deploying with account: ${deployer.address}`);
    console.log(`Account balance: ${(await deployer.provider.getBalance(deployer.address)).toString()}\n`);
    
    // Configuration
    const network = hre.network.name;
    console.log(`Network: ${network}\n`);
    
    // Wallet addresses (update these for production)
    const config = {
        teamWallet: deployer.address,      // Update with actual team wallet
        liquidityWallet: deployer.address,  // Update with actual liquidity wallet
        ecosystemWallet: deployer.address,  // Update with actual ecosystem wallet
        reserveWallet: deployer.address,    // Update with actual reserve wallet
        treasury: deployer.address,         // Platform fee treasury
    };
    
    // USDT address (Polygon Mainnet)
    const USDT_ADDRESS = {
        polygon: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
        mumbai: "0xA02f6adc7926efeBBd59fd43A84f4E0c0c991e9d", // Test USDT
    };
    
    const usdtAddress = USDT_ADDRESS[network] || USDT_ADDRESS.mumbai;
    console.log(`Using USDT at: ${usdtAddress}\n`);
    
    const deployments = {};
    
    // ============================================
    // 1. Deploy HAULToken
    // ============================================
    console.log("📦 Deploying HAULToken...");
    const HAULToken = await hre.ethers.getContractFactory("HAULToken");
    const haulToken = await HAULToken.deploy(
        config.teamWallet,
        config.liquidityWallet,
        config.ecosystemWallet,
        config.reserveWallet
    );
    await haulToken.waitForDeployment();
    const haulTokenAddress = await haulToken.getAddress();
    deployments.HAULToken = haulTokenAddress;
    console.log(`✅ HAULToken deployed to: ${haulTokenAddress}`);
    console.log(`   Max Supply: ${(await haulToken.MAX_SUPPLY()).toString()}`);
    console.log(`   Total Supply: ${(await haulToken.totalSupply()).toString()}\n`);
    
    // ============================================
    // 2. Deploy ReputationContract
    // ============================================
    console.log("📦 Deploying ReputationContract...");
    const ReputationContract = await hre.ethers.getContractFactory("ReputationContract");
    const reputationContract = await ReputationContract.deploy();
    await reputationContract.waitForDeployment();
    const reputationAddress = await reputationContract.getAddress();
    deployments.ReputationContract = reputationAddress;
    console.log(`✅ ReputationContract deployed to: ${reputationAddress}\n`);
    
    // ============================================
    // 3. Deploy DisputeContract
    // ============================================
    console.log("📦 Deploying DisputeContract...");
    const DisputeContract = await hre.ethers.getContractFactory("DisputeContract");
    const disputeContract = await DisputeContract.deploy(reputationAddress);
    await disputeContract.waitForDeployment();
    const disputeAddress = await disputeContract.getAddress();
    deployments.DisputeContract = disputeAddress;
    console.log(`✅ DisputeContract deployed to: ${disputeAddress}\n`);
    
    // ============================================
    // 4. Deploy OrderContract
    // ============================================
    console.log("📦 Deploying OrderContract...");
    const OrderContract = await hre.ethers.getContractFactory("OrderContract");
    const orderContract = await OrderContract.deploy(
        usdtAddress,
        reputationAddress,
        disputeAddress,
        config.treasury
    );
    await orderContract.waitForDeployment();
    const orderAddress = await orderContract.getAddress();
    deployments.OrderContract = orderAddress;
    console.log(`✅ OrderContract deployed to: ${orderAddress}\n`);
    
    // ============================================
    // 5. Setup Authorizations
    // ============================================
    console.log("🔐 Setting up contract authorizations...\n");
    
    // Authorize OrderContract to update reputation
    console.log("Authorizing OrderContract on ReputationContract...");
    await (await reputationContract.authorizeUpdater(orderAddress)).wait();
    console.log("✅ OrderContract authorized\n");
    
    // Authorize DisputeContract to update reputation
    console.log("Authorizing DisputeContract on ReputationContract...");
    await (await reputationContract.authorizeUpdater(disputeAddress)).wait();
    console.log("✅ DisputeContract authorized\n");
    
    // Authorize OrderContract to create disputes
    // Note: DisputeContract uses msg.sender check, no additional authorization needed
    
    // ============================================
    // 6. Save Deployment Info
    // ============================================
    const deploymentInfo = {
        network: network,
        chainId: (await deployer.provider.getNetwork()).chainId.toString(),
        deployer: deployer.address,
        timestamp: new Date().toISOString(),
        contracts: deployments,
        config: config,
    };
    
    // Save to file
    const deploymentsDir = path.join(__dirname, '..', 'deployments');
    if (!fs.existsSync(deploymentsDir)) {
        fs.mkdirSync(deploymentsDir, { recursive: true });
    }
    
    const filename = `${network}-${Date.now()}.json`;
    fs.writeFileSync(
        path.join(deploymentsDir, filename),
        JSON.stringify(deploymentInfo, null, 2)
    );
    
    // Save latest
    fs.writeFileSync(
        path.join(deploymentsDir, 'latest.json'),
        JSON.stringify(deploymentInfo, null, 2)
    );
    
    // ============================================
    // 7. Verification (for mainnet/testnet)
    // ============================================
    if (network !== 'hardhat' && network !== 'localhost') {
        console.log("⏳ Waiting for block confirmations before verification...\n");
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30s
        
        console.log("🔍 Verifying contracts on Polygonscan...\n");
        
        try {
            await hre.run("verify:verify", {
                address: haulTokenAddress,
                constructorArguments: [
                    config.teamWallet,
                    config.liquidityWallet,
                    config.ecosystemWallet,
                    config.reserveWallet,
                ],
            });
            console.log("✅ HAULToken verified");
        } catch (e) {
            console.log(`⚠️ HAULToken verification failed: ${e.message}`);
        }
        
        try {
            await hre.run("verify:verify", {
                address: reputationAddress,
                constructorArguments: [],
            });
            console.log("✅ ReputationContract verified");
        } catch (e) {
            console.log(`⚠️ ReputationContract verification failed: ${e.message}`);
        }
        
        try {
            await hre.run("verify:verify", {
                address: disputeAddress,
                constructorArguments: [reputationAddress],
            });
            console.log("✅ DisputeContract verified");
        } catch (e) {
            console.log(`⚠️ DisputeContract verification failed: ${e.message}`);
        }
        
        try {
            await hre.run("verify:verify", {
                address: orderAddress,
                constructorArguments: [
                    usdtAddress,
                    reputationAddress,
                    disputeAddress,
                    config.treasury,
                ],
            });
            console.log("✅ OrderContract verified");
        } catch (e) {
            console.log(`⚠️ OrderContract verification failed: ${e.message}`);
        }
    }
    
    // ============================================
    // 8. Summary
    // ============================================
    console.log("\n" + "=".repeat(60));
    console.log("🎉 OpenHaul Protocol Deployment Complete!");
    console.log("=".repeat(60) + "\n");
    
    console.log("Contract Addresses:");
    console.log("-".repeat(40));
    for (const [name, address] of Object.entries(deployments)) {
        console.log(`${name.padEnd(25)} ${address}`);
    }
    
    console.log("\n" + "=".repeat(60));
    console.log("Next Steps:");
    console.log("=".repeat(60));
    console.log("1. Update wallet addresses in config for production");
    console.log("2. Distribute HAUL tokens from deployer to actual wallets");
    console.log("3. Fund DisputeContract with initial HAUL for juror stakes");
    console.log("4. Test full order lifecycle on testnet");
    console.log("5. Audit contracts before mainnet deployment");
    console.log("\nDeployment info saved to: deployments/" + filename);
    console.log("=".repeat(60) + "\n");
}

// Execute deployment
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\n❌ Deployment failed:\n", error);
        process.exit(1);
    });
