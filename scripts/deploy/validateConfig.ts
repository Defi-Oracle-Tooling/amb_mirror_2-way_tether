import { ethers } from "hardhat";
import { DeploymentConfig, getNetworkConfig } from "./config";
import { NetworkConfig } from "../../src/admin-panel/types/config";

export async function validateChainConfig(
    config: DeploymentConfig,
    networkName: string
): Promise<void> {
    const networkConfig = getNetworkConfig(networkName);
    const provider = new ethers.providers.JsonRpcProvider(networkConfig.rpcUrl);

    console.log(`Validating configuration for ${networkName}...`);

    try {
        // Check network connectivity
        const network = await provider.getNetwork();
        if (network.chainId !== networkConfig.chainId) {
            throw new Error(`Chain ID mismatch. Expected ${networkConfig.chainId}, got ${network.chainId}`);
        }

        // Validate deployer account
        const [deployer] = await ethers.getSigners();
        const balance = await provider.getBalance(deployer.address);
        if (balance.isZero()) {
            throw new Error(`Deployer account ${deployer.address} has no balance on ${networkName}`);
        }

        // Validate admin addresses
        for (const admin of config.initialAdmins) {
            if (!ethers.utils.isAddress(admin)) {
                throw new Error(`Invalid admin address: ${admin}`);
            }
        }

        // Validate operator addresses
        for (const operator of config.initialOperators) {
            if (!ethers.utils.isAddress(operator)) {
                throw new Error(`Invalid operator address: ${operator}`);
            }
        }

        // Validate guardian addresses
        for (const guardian of config.initialGuardians) {
            if (!ethers.utils.isAddress(guardian)) {
                throw new Error(`Invalid guardian address: ${guardian}`);
            }
        }

        // Check if network supports contract verification
        if (config.verifyContracts) {
            const explorerUrl = networkConfig.explorerUrl;
            if (!explorerUrl) {
                throw new Error(`No explorer URL configured for ${networkName}`);
            }
            if (!process.env[`${networkName.toUpperCase()}_ETHERSCAN_API_KEY`]) {
                throw new Error(`No explorer API key found for ${networkName}`);
            }
        }

        // Validate required confirmations
        if (networkConfig.requiredConfirmations < 1) {
            throw new Error(`Invalid required confirmations for ${networkName}`);
        }

        console.log(`Configuration validation successful for ${networkName}`);
    } catch (error) {
        throw new Error(`Configuration validation failed for ${networkName}: ${error.message}`);
    }
}

export async function validateMultiChainConfig(config: DeploymentConfig): Promise<void> {
    const allNetworks = new Set([...config.sourceNetworks, ...config.targetNetworks]);
    
    // Validate each network configuration
    for (const network of allNetworks) {
        await validateChainConfig(config, network);
    }

    // Validate cross-chain requirements
    if (config.sourceNetworks.length === 0) {
        throw new Error("No source networks configured");
    }

    if (config.targetNetworks.length === 0) {
        throw new Error("No target networks configured");
    }

    // Ensure there's at least one network that can communicate with each other
    const hasValidPair = config.sourceNetworks.some(source => 
        config.targetNetworks.some(target => source !== target)
    );

    if (!hasValidPair) {
        throw new Error("No valid source-target network pairs found");
    }

    console.log("Multi-chain configuration validation successful");
}