require('dotenv').config();
import { ethers } from "ethers";
import { BridgeConfig, ChainConfig, BridgeFeature, BridgeRole } from "../../src/admin-panel/types/BridgeAdmin";
import { validateBridgeConfig } from "./validateConfig";
import { ContractFactory } from "ethers";

export function loadConfig(environment: string): BridgeConfig {
    let config: BridgeConfig;

    try {
        config = require(`../../config/${environment}.json`);
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        throw new Error(`Failed to load config for environment ${environment}: ${errorMessage}`);
    }

    // Validate the loaded configuration
    validateBridgeConfig(config);
    return config;
}

export function getDefaultFeatures(): BridgeFeature[] {
    return [
        {
            name: "CROSS_CHAIN_MIRROR",
            enabled: false,
            description: "Enables cross-chain transaction mirroring",
            requiredRole: BridgeRole.OPERATOR
        },
        {
            name: "EMERGENCY_SHUTDOWN",
            enabled: false,
            description: "Allows emergency shutdown of bridge operations",
            requiredRole: BridgeRole.GUARDIAN
        },
        {
            name: "ROLE_MANAGEMENT",
            enabled: false,
            description: "Enables role assignment and management",
            requiredRole: BridgeRole.ADMIN
        }
    ];
}

export function generateTestnetConfig(
    localRpcUrl: string = "http://localhost:8545"
): BridgeConfig {
    const testChains: ChainConfig[] = [
        {
            chainId: 31337, // Hardhat's default chain ID
            name: "Local Testnet 1",
            isSupported: true,
            rpcUrl: process.env.LOCAL_RPC_URL || localRpcUrl
        },
        {
            chainId: 31338,
            name: "Local Testnet 2",
            isSupported: true,
            rpcUrl: process.env.LOCAL_RPC_URL_2 || localRpcUrl.replace("8545", "8546") // Assuming second chain on different port
        }
    ];

    return {
        features: getDefaultFeatures(),
        chains: testChains,
        governance: {
            threshold: 1, // Single signature for testing
            minDelay: 0, // No delay for testing
            guardianDelay: 0
        },
        monitoring: {
            errorThreshold: 3,
            alertInterval: 1000,
            maxRetries: 3
        }
    };
}

export async function deployTestEnvironment(
    config: BridgeConfig,
    deployer: ethers.Signer
): Promise<{
    bridges: Map<number, string>,
    governance: Map<number, string>
}> {
    const deployments = {
        bridges: new Map<number, string>(),
        governance: new Map<number, string>()
    };

    for (const chain of config.chains) {
        // Deploy Governance using ContractFactory
        const governanceFactory = new ContractFactory(
            ["..."], // ABI will be loaded from artifacts
            "...",   // Bytecode will be loaded from artifacts
            deployer
        );
        const governance = await governanceFactory.deploy();
        await governance.waitForDeployment();
        const governanceAddress = await governance.getAddress();

        // Deploy Bridge with governance address
        const bridgeFactory = new ContractFactory(
            ["..."], // ABI will be loaded from artifacts
            "...",   // Bytecode will be loaded from artifacts
            deployer
        );
        const bridge = await bridgeFactory.deploy(governanceAddress);
        await bridge.waitForDeployment();
        const bridgeAddress = await bridge.getAddress();

        deployments.bridges.set(chain.chainId, bridgeAddress);
        deployments.governance.set(chain.chainId, governanceAddress);

        // Initialize governance
        const governanceContract = governanceFactory.attach(governanceAddress);
        await governanceContract.updateThreshold(config.governance.threshold);

        // Enable features
        const bridgeContract = bridgeFactory.attach(bridgeAddress);
        for (const feature of config.features) {
            if (feature.enabled) {
                await bridgeContract.toggleFeature(feature.name, true);
            }
        }
    }

    return deployments;
}

export async function setupCrossChainConnections(
    config: BridgeConfig,
    deployments: {
        bridges: Map<number, string>,
        governance: Map<number, string>
    },
    deployer: ethers.Signer
): Promise<void> {
    const bridgeFactory = new ContractFactory(
        ["..."], // ABI will be loaded from artifacts
        "...",   // Bytecode will be loaded from artifacts
        deployer
    );

    for (const sourceChain of config.chains) {
        const bridgeAddress = deployments.bridges.get(sourceChain.chainId);
        if (!bridgeAddress) continue;

        const bridge = bridgeFactory.attach(bridgeAddress);

        // Enable connections to all other chains
        for (const targetChain of config.chains) {
            if (targetChain.chainId !== sourceChain.chainId) {
                await bridge.updateSupportedChain(
                    targetChain.chainId,
                    targetChain.isSupported
                );
            }
        }
    }
}