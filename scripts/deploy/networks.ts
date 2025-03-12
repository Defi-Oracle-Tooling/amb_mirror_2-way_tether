import { ethers } from "ethers";
import { ChainConfig } from "../../src/admin-panel/types/BridgeAdmin";
import { validateChainConnection } from "./validateConfig";

export class NetworkManager {
    private providers: Map<number, ethers.JsonRpcProvider> = new Map();
    private configs: Map<number, ChainConfig> = new Map();

    async initializeNetworks(chains: ChainConfig[]): Promise<void> {
        for (const chain of chains) {
            // Validate chain connection first
            await validateChainConnection(chain.chainId, chain.rpcUrl);
            
            // Create and store provider
            const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
            this.providers.set(chain.chainId, provider);
            this.configs.set(chain.chainId, chain);
        }
    }

    getProvider(chainId: number): ethers.JsonRpcProvider {
        const provider = this.providers.get(chainId);
        if (!provider) {
            throw new Error(`No provider configured for chain ${chainId}`);
        }
        return provider;
    }

    getChainConfig(chainId: number): ChainConfig {
        const config = this.configs.get(chainId);
        if (!config) {
            throw new Error(`No configuration found for chain ${chainId}`);
        }
        return config;
    }

    async verifyChainConnections(): Promise<boolean> {
        const verifications = Array.from(this.providers.entries()).map(
            async ([chainId, provider]) => {
                try {
                    const network = await provider.getNetwork();
                    if (network.chainId !== BigInt(chainId)) {
                        throw new Error(`Chain ID mismatch for ${chainId}`);
                    }
                    return true;
                } catch (err) {
                    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                    throw new Error(`Failed to verify chain ${chainId}: ${errorMessage}`);
                }
            }
        );

        await Promise.all(verifications);
        return true;
    }

    async deployBridgeContracts(
        governanceFactory: ethers.ContractFactory,
        bridgeFactory: ethers.ContractFactory,
        signer: ethers.Signer
    ): Promise<Map<number, { governance: string; bridge: string }>> {
        const deployments = new Map<number, { governance: string; bridge: string }>();

        for (const [chainId, provider] of this.providers) {
            const connectedSigner = signer.connect(provider);
            
            // Deploy governance first
            const governance = await governanceFactory.connect(connectedSigner).deploy();
            await governance.waitForDeployment();
            const governanceAddress = await governance.getAddress();

            // Deploy bridge with governance address
            const bridge = await bridgeFactory.connect(connectedSigner).deploy(governanceAddress);
            await bridge.waitForDeployment();
            const bridgeAddress = await bridge.getAddress();

            deployments.set(chainId, {
                governance: governanceAddress,
                bridge: bridgeAddress
            });
        }

        return deployments;
    }

    async configureBridgeContracts(
        deployments: Map<number, { governance: string; bridge: string }>,
        signer: ethers.Signer,
        bridgeABI: ethers.InterfaceAbi,
        governanceABI: ethers.InterfaceAbi
    ): Promise<void> {
        const chainIds = Array.from(deployments.keys());
        
        for (const sourceChainId of chainIds) {
            const sourceProvider = this.getProvider(sourceChainId);
            const sourceContracts = deployments.get(sourceChainId);
            if (!sourceContracts) continue;

            const bridge = new ethers.Contract(
                sourceContracts.bridge,
                bridgeABI,
                signer.connect(sourceProvider)
            );

            // Enable CROSS_CHAIN_MIRROR feature
            await bridge.toggleFeature("CROSS_CHAIN_MIRROR", true);

            // Enable connections to all other chains
            for (const targetChainId of chainIds) {
                if (targetChainId !== sourceChainId) {
                    await bridge.updateSupportedChain(targetChainId, true);
                }
            }
        }
    }
}