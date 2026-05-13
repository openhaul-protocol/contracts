require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/**
 * OpenHaul Protocol — Hardhat Configuration
 *
 * P1 fixes:
 *   - Mumbai replaced with Amoy (Mumbai deprecated 2024-04-08)
 *   - EIP-1559 gas settings for Polygon
 *   - chainId explicitly set
 *   - Supports mnemonic OR private key
 */

function getAccounts() {
  if (process.env.MNEMONIC) {
    return { mnemonic: process.env.MNEMONIC };
  }
  if (process.env.DEPLOYER_PRIVATE_KEY) {
    return [process.env.DEPLOYER_PRIVATE_KEY];
  }
  return [];
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: false
    }
  },

  networks: {
    hardhat: {
      chainId: 31337
    },

    // P1 FIX: Amoy replaces Mumbai (Mumbai shut down April 2024)
    polygon_amoy: {
      url: process.env.POLYGON_AMOY_RPC || "https://rpc-amoy.polygon.technology",
      chainId: 80002,
      accounts: getAccounts(),
      // EIP-1559 gas settings — more reliable than gasPrice on Polygon
      maxFeePerGas: 30_000_000_000,          // 30 gwei
      maxPriorityFeePerGas: 25_000_000_000,  // 25 gwei
    },

    polygon_mainnet: {
      url: process.env.POLYGON_MAINNET_RPC || "https://polygon-rpc.com",
      chainId: 137,
      accounts: getAccounts(),
      maxFeePerGas: 200_000_000_000,         // 200 gwei ceiling
      maxPriorityFeePerGas: 30_000_000_000,  // 30 gwei tip
    },
  },

  etherscan: {
    apiKey: {
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      polygonAmoy: process.env.POLYGONSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "polygonAmoy",
        chainId: 80002,
        urls: {
          apiURL: "https://api-amoy.polygonscan.com/api",
          browserURL: "https://amoy.polygonscan.com"
        }
      }
    ]
  },

  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    coinmarketcap: process.env.CMC_API_KEY
  }
};
