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
        const erc20FacetArtifact = loadContractArtifact('ERC20Facet');
        const erc721FacetArtifact = loadContractArtifact('ERC721Facet');
        const erc777FacetArtifact = loadContractArtifact('ERC777Facet');
        const erc1155FacetArtifact = loadContractArtifact('ERC1155Facet');
        const globalReserveUnitArtifact = loadContractArtifact('GlobalReserveUnit');

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

        const erc20FacetFactory = new ethers.ContractFactory(
            erc20FacetArtifact.abi,
            erc20FacetArtifact.bytecode,
            wallet
        );

        const erc721FacetFactory = new ethers.ContractFactory(
            erc721FacetArtifact.abi,
            erc721FacetArtifact.bytecode,
            wallet
        );

        const erc777FacetFactory = new ethers.ContractFactory(
            erc777FacetArtifact.abi,
            erc777FacetArtifact.bytecode,
            wallet
        );

        const erc1155FacetFactory = new ethers.ContractFactory(
            erc1155FacetArtifact.abi,
            erc1155FacetArtifact.bytecode,
            wallet
        );

        const globalReserveUnitFactory = new ethers.ContractFactory(
            globalReserveUnitArtifact.abi,
            globalReserveUnitArtifact.bytecode,
            wallet
        );

        // Deploy contracts
        const deployments = await networkManager.deployBridgeContracts(
            governanceFactory,
            bridgeFactory,
            wallet
        );

        const erc20FacetDeployment = await erc20FacetFactory.deploy();
        await erc20FacetDeployment.deployed();
        console.log(`ERC20Facet deployed to: ${erc20FacetDeployment.address}`);

        const erc721FacetDeployment = await erc721FacetFactory.deploy();
        await erc721FacetDeployment.deployed();
        console.log(`ERC721Facet deployed to: ${erc721FacetDeployment.address}`);

        const erc777FacetDeployment = await erc777FacetFactory.deploy();
        await erc777FacetDeployment.deployed();
        console.log(`ERC777Facet deployed to: ${erc777FacetDeployment.address}`);

        const erc1155FacetDeployment = await erc1155FacetFactory.deploy();
        await erc1155FacetDeployment.deployed();
        console.log(`ERC1155Facet deployed to: ${erc1155FacetDeployment.address}`);

        const globalReserveUnitDeployment = await globalReserveUnitFactory.deploy(wallet.address, erc20FacetDeployment.address);
        await globalReserveUnitDeployment.deployed();
        console.log(`Global Reserve Unit deployed to: ${globalReserveUnitDeployment.address}`);

        // Add facets to the Diamond contract
        const diamondCut = [
            {
                facetAddress: erc20FacetDeployment.address,
                action: 0, // Add
                functionSelectors: Object.keys(erc20FacetArtifact.abi).map(key => erc20FacetArtifact.abi[key].signature)
            },
            {
                facetAddress: erc721FacetDeployment.address,
                action: 0, // Add
                functionSelectors: Object.keys(erc721FacetArtifact.abi).map(key => erc721FacetArtifact.abi[key].signature)
            },
            {
                facetAddress: erc777FacetDeployment.address,
                action: 0, // Add
                functionSelectors: Object.keys(erc777FacetArtifact.abi).map(key => erc777FacetArtifact.abi[key].signature)
            },
            {
                facetAddress: erc1155FacetDeployment.address,
                action: 0, // Add
                functionSelectors: Object.keys(erc1155FacetArtifact.abi).map(key => erc1155FacetArtifact.abi[key].signature)
            }
        ];

        const diamondCutTx = await globalReserveUnitDeployment.diamondCut(diamondCut, ethers.constants.AddressZero, "0x");
        await diamondCutTx.wait();
        console.log(`Facets added to the Diamond contract`);

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