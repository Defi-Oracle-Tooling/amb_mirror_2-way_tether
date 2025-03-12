import { ethers } from "hardhat";
import { BridgeConfig } from "../../src/admin-panel/types/BridgeAdmin";

export function validateBridgeConfig(config: BridgeConfig): void {
    validateGovernanceConfig(config.governance);
    validateChainConfigs(config.chains);
    validateFeatures(config.features);
    validateMonitoringConfig(config.monitoring);
}

function validateGovernanceConfig(governance: BridgeConfig['governance']): void {
    if (governance.threshold < 1) {
        throw new Error("Governance threshold must be at least 1");
    }
    if (governance.minDelay < 0) {
        throw new Error("Minimum delay cannot be negative");
    }
    if (governance.guardianDelay < governance.minDelay) {
        throw new Error("Guardian delay must be greater than or equal to minimum delay");
    }
}

function validateChainConfigs(chains: BridgeConfig['chains']): void {
    // Check for duplicate chain IDs
    const chainIds = new Set<number>();
    for (const chain of chains) {
        if (chainIds.has(chain.chainId)) {
            throw new Error(`Duplicate chain ID found: ${chain.chainId}`);
        }
        chainIds.add(chain.chainId);

        // Validate RPC URL format
        if (!chain.rpcUrl.startsWith('http://') && !chain.rpcUrl.startsWith('https://')) {
            throw new Error(`Invalid RPC URL format for chain ${chain.chainId}: ${chain.rpcUrl}`);
        }

        // Validate chain name
        if (!chain.name || chain.name.length < 1) {
            throw new Error(`Chain name is required for chain ID ${chain.chainId}`);
        }
    }

    // Ensure at least two chains for bridging
    if (chains.length < 2) {
        throw new Error("At least two chains must be configured for bridging");
    }
}

function validateFeatures(features: BridgeConfig['features']): void {
    // Check for duplicate feature names
    const featureNames = new Set<string>();
    for (const feature of features) {
        if (featureNames.has(feature.name)) {
            throw new Error(`Duplicate feature name found: ${feature.name}`);
        }
        featureNames.add(feature.name);

        // Validate required fields
        if (!feature.description) {
            throw new Error(`Description is required for feature ${feature.name}`);
        }
        if (feature.requiredRole < 0 || feature.requiredRole > 3) {
            throw new Error(`Invalid role for feature ${feature.name}: ${feature.requiredRole}`);
        }
    }

    // Ensure CROSS_CHAIN_MIRROR feature exists
    if (!features.some(f => f.name === "CROSS_CHAIN_MIRROR")) {
        throw new Error("CROSS_CHAIN_MIRROR feature must be configured");
    }
}

function validateMonitoringConfig(monitoring: BridgeConfig['monitoring']): void {
    if (monitoring.errorThreshold < 0) {
        throw new Error("Error threshold cannot be negative");
    }
    if (monitoring.alertInterval < 1000) { // Minimum 1 second
        throw new Error("Alert interval must be at least 1000ms");
    }
    if (monitoring.maxRetries < 0) {
        throw new Error("Max retries cannot be negative");
    }
}

export function validateChainConnection(chainId: number, rpcUrl: string): Promise<boolean> {
    // This will be implemented using ethers.js to test RPC connection
    return new Promise((resolve, reject) => {
        try {
            const provider = new ethers.JsonRpcProvider(rpcUrl);
            provider.getNetwork()
                .then(network => {
                    if (network.chainId === BigInt(chainId)) {
                        resolve(true);
                    } else {
                        reject(new Error(`Chain ID mismatch. Expected: ${chainId}, Got: ${network.chainId}`));
                    }
                })
                .catch(error => {
                    reject(new Error(`Failed to connect to RPC: ${error.message}`));
                });
        } catch (error) {
            reject(new Error(`Invalid RPC URL: ${error.message}`));
        }
    });
}