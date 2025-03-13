require('dotenv').config();
import { ethers } from "ethers";
import { BridgeConfig, ChainConfig, BridgeFeature, BridgeRole } from "../../src/admin-panel/types/BridgeAdmin";
import { validateBridgeConfig } from "./validateConfig";
import { ContractFactory } from "ethers";

export function loadConfig(environment: string): BridgeConfig {
    let config: BridgeConfig;

    // Load environment specific config
    try {
        config = require(`../../config/${environment}.json`);
    } catch (error) {
        throw new Error(`Failed to load config for environment: ${environment}`);
    }

    // Validate config
    validateBridgeConfig(config);
    return config;
}

export function getDefaultFeatures(): BridgeFeature[] {
    return [
        'CROSS_CHAIN_MIRROR',
        'ERC20_BRIDGE',
        'ERC721_BRIDGE',
        'ERC1155_BRIDGE',
        'ERC4626_BRIDGE',
        'ERC777_BRIDGE'
    ];
}

export function generateTestnetConfig(
    localRpcUrl: string = "http://localhost:8545"
): BridgeConfig {
    return {
        governance: {
            signatureThreshold: 2,
            roles: [
                { role: BridgeRole.ADMIN, id: 2 },
                { role: BridgeRole.OPERATOR, id: 1 },
                { role: BridgeRole.GUARDIAN, id: 3 }
            ]
        },
        chains: [
            {
                chainId: 1,
                rpcUrl: localRpcUrl,
                confirmations: 1,
                features: getDefaultFeatures()
            },
            {
                chainId: 2, 
                rpcUrl: localRpcUrl,
                confirmations: 1,
                features: getDefaultFeatures()
            }
        ],
        features: getDefaultFeatures(),
        monitoring: {
            alertThresholds: {
                transactionDelay: 5000,
                signatureDelay: 3000,
                errorRate: 10,
                blockConfirmations: 12,
                crossChainLatency: 10000
            },
            healthCheckInterval: 1000
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
    const bridges = new Map<number, string>();
    const governance = new Map<number, string>();

    // Deploy contracts for each chain
    for (const chain of config.chains) {
        const BridgeGovernance = await ethers.getContractFactory("BridgeGovernance", deployer);
        const governanceContract = await BridgeGovernance.deploy();
        await governanceContract.waitForDeployment();
        governance.set(chain.chainId, await governanceContract.getAddress());

        const BridgeMirror = await ethers.getContractFactory("BridgeMirror", deployer);
        const bridgeContract = await BridgeMirror.deploy(await governanceContract.getAddress());
        await bridgeContract.waitForDeployment();
        bridges.set(chain.chainId, await bridgeContract.getAddress());

        // Setup roles
        await governanceContract.updateThreshold(config.governance.signatureThreshold);
    }

    return { bridges, governance };
}

export async function setupCrossChainConnections(
    config: BridgeConfig,
    deployments: {
        bridges: Map<number, string>,
        governance: Map<number, string>
    },
    deployer: ethers.Signer
): Promise<void> {
    const BridgeGovernance = await ethers.getContractFactory("BridgeGovernance", deployer);

    // Setup cross-chain connections for each chain
    for (const chain of config.chains) {
        const governanceContract = BridgeGovernance.attach(deployments.governance.get(chain.chainId) || '');

        // Enable features
        for (const feature of chain.features) {
            await governanceContract.connect(deployer).toggleFeature(feature, true);
        }

        // Setup roles for each chain
        for (const roleConfig of config.governance.roles) {
            // Get admin addresses from environment or config
            const adminAddresses = [await deployer.getAddress()]; // Add more addresses as needed
            for (const adminAddress of adminAddresses) {
                await governanceContract.connect(deployer).assignRole(adminAddress, roleConfig.id);
            }
        }
    }
}