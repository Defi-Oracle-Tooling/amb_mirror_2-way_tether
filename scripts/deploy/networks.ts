import { NetworkConfig } from "../../src/admin-panel/types/config";

export const networks: { [key: string]: NetworkConfig } = {
    ethereum: {
        chainId: 1,
        rpcUrl: process.env.ETH_RPC_URL || "",
        name: "Ethereum Mainnet",
        explorerUrl: "https://etherscan.io",
        isSource: true,
        isTarget: true,
        requiredConfirmations: 12
    },
    polygon: {
        chainId: 137,
        rpcUrl: process.env.POLYGON_RPC_URL || "",
        name: "Polygon Mainnet",
        explorerUrl: "https://polygonscan.com",
        isSource: true,
        isTarget: true,
        requiredConfirmations: 256
    },
    arbitrum: {
        chainId: 42161,
        rpcUrl: process.env.ARBITRUM_RPC_URL || "",
        name: "Arbitrum One",
        explorerUrl: "https://arbiscan.io",
        isSource: true,
        isTarget: true,
        requiredConfirmations: 64
    },
    optimism: {
        chainId: 10,
        rpcUrl: process.env.OPTIMISM_RPC_URL || "",
        name: "Optimism",
        explorerUrl: "https://optimistic.etherscan.io",
        isSource: true,
        isTarget: true,
        requiredConfirmations: 50
    },
    // Test networks
    goerli: {
        chainId: 5,
        rpcUrl: process.env.GOERLI_RPC_URL || "",
        name: "Goerli Testnet",
        explorerUrl: "https://goerli.etherscan.io",
        isSource: true,
        isTarget: true,
        requiredConfirmations: 6
    },
    mumbai: {
        chainId: 80001,
        rpcUrl: process.env.MUMBAI_RPC_URL || "",
        name: "Polygon Mumbai",
        explorerUrl: "https://mumbai.polygonscan.com",
        isSource: true,
        isTarget: true,
        requiredConfirmations: 12
    }
};