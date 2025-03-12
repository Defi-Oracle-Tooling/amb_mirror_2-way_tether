import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

require('dotenv').config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    localhost: {
      url: process.env.LOCAL_RPC_URL || 'http://localhost:8545'
    },
    goerli: {
      url: process.env.GOERLI_RPC_URL,
      accounts: process.env.TESTNET_ADMINS ? process.env.TESTNET_ADMINS.split(',') : []
    },
    ethereum: {
      url: process.env.MAINNET_RPC_URL,
      accounts: process.env.MAINNET_ADMINS ? process.env.MAINNET_ADMINS.split(',') : []
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6"
  }
};

export default config;