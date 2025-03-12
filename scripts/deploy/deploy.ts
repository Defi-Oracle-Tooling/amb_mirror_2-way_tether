import { ethers } from "ethers";
import { MonitoringService } from "../../src/utils/MonitoringService";
import { NetworkManager } from "./networks";
import { loadConfig, deployTestEnvironment, setupCrossChainConnections } from "./config";
import { BridgeService } from "../../src/services/BridgeService";
import fs from 'fs';
import path from 'path';

// Load contract artifacts
const loadContractArtifact = (contractName: string) => {
    const artifactPath = path.join(__dirname, `../../artifacts/contracts/${contractName}.sol/${contractName}.json`);
    const artifactContent = fs.readFileSync(artifactPath, 'utf-8');
    return JSON.parse(artifactContent);
};

async function main() {
    try {
        // Get deployment environment from args or default to local
        const environment = process.env.DEPLOY_ENV || 'local';
        
        // Initialize services
        const config = loadConfig(environment);
        const monitoring = new MonitoringService();
        const networkManager = new NetworkManager();

        // Setup network connections
        await networkManager.initializeNetworks(config.chains);
        await networkManager.verifyChainConnections();

        // Load contract artifacts
        const bridgeArtifact = loadContractArtifact('BridgeMirror');
        const governanceArtifact = loadContractArtifact('BridgeGovernance');

        // Create contract factories
        const provider = networkManager.getProvider(config.chains[0].chainId); // Use first chain for deployment
        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);
        
        const bridgeFactory = new ethers.ContractFactory(
            bridgeArtifact.abi,
            bridgeArtifact.bytecode,
            wallet
        );
        
        const governanceFactory = new ethers.ContractFactory(
            governanceArtifact.abi,
            governanceArtifact.bytecode,
            wallet
        );

        // Deploy contracts
        const deployments = await networkManager.deployBridgeContracts(
            governanceFactory,
            bridgeFactory,
            wallet
        );
        
        // Setup cross-chain connections
        await networkManager.configureBridgeContracts(
            deployments,
            wallet,
            bridgeArtifact.abi,
            governanceArtifact.abi
        );

        // Initialize bridge services
        const bridgeServices = new Map<number, BridgeService>();
        
        for (const chain of config.chains) {
            const addresses = deployments.get(chain.chainId);
            if (!addresses) {
                throw new Error(`Missing deployment for chain ${chain.chainId}`);
            }

            const provider = networkManager.getProvider(chain.chainId);
            const bridge = new ethers.Contract(
                addresses.bridge,
                bridgeArtifact.abi,
                provider
            );
            
            const governance = new ethers.Contract(
                addresses.governance,
                governanceArtifact.abi,
                provider
            );

            bridgeServices.set(
                chain.chainId,
                new BridgeService(bridge, governance, monitoring)
            );
        }

        // Create deployment directory if it doesn't exist
        const deploymentDir = path.join(__dirname, `../../deployments/${environment}`);
        if (!fs.existsSync(deploymentDir)) {
            fs.mkdirSync(deploymentDir, { recursive: true });
        }

        // Save deployment info
        const deploymentInfo = {
            environment,
            timestamp: new Date().toISOString(),
            deployer: wallet.address,
            deployments: Object.fromEntries(deployments),
            chains: config.chains
        };

        fs.writeFileSync(
            path.join(deploymentDir, 'deployment.json'),
            JSON.stringify(deploymentInfo, null, 2)
        );

        console.log("Deployment completed successfully");
        console.log("Deployments:", {
            chains: Object.fromEntries(deployments)
        });

    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error("Deployment failed:", errorMessage);
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });