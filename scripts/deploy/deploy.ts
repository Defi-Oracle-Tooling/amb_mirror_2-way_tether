import { ethers, network, run } from "hardhat";
import {
    getDeploymentConfig,
    validateDeploymentConfig,
    generateBridgeConfig,
    getNetworkConfig
} from "./config";
import fs from "fs";
import path from "path";
import { BridgeGovernance, BridgeMirror } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

interface DeploymentResult {
    network: string;
    chainId: number;
    governance: string;
    bridge: string;
    timestamp: number;
}

async function main() {
    // Get deployment environment from command line or default to local
    const environment = process.env.DEPLOY_ENV || "local";
    console.log(`Deploying to ${environment} environment`);

    // Load and validate configuration
    const deployConfig = getDeploymentConfig(environment);
    validateDeploymentConfig(deployConfig);
    const bridgeConfig = generateBridgeConfig(deployConfig);

    // Verify we're on a supported network
    const networkName = network.name;
    if (!deployConfig.sourceNetworks.includes(networkName) && 
        !deployConfig.targetNetworks.includes(networkName)) {
        throw new Error(`Network ${networkName} is not configured for ${environment}`);
    }

    const [deployer] = await ethers.getSigners() as [HardhatEthersSigner];
    console.log(`Deploying contracts with account: ${deployer.address}`);
    console.log(`Account balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))}`);

    try {
        // Deploy Governance contract
        console.log("Deploying BridgeGovernance...");
        const BridgeGovernanceFactory = await ethers.getContractFactory("BridgeGovernance");
        const governance = await BridgeGovernanceFactory.deploy() as BridgeGovernance;
        await governance.waitForDeployment();
        const governanceAddress = await governance.getAddress();
        console.log("BridgeGovernance deployed to:", governanceAddress);

        // Deploy Bridge contract
        console.log("Deploying BridgeMirror...");
        const BridgeMirrorFactory = await ethers.getContractFactory("BridgeMirror");
        const bridge = await BridgeMirrorFactory.deploy(governanceAddress) as BridgeMirror;
        await bridge.waitForDeployment();
        const bridgeAddress = await bridge.getAddress();
        console.log("BridgeMirror deployed to:", bridgeAddress);

        // Initialize roles
        console.log("Initializing roles and configuration...");
        
        // Setup admins
        for (const admin of deployConfig.initialAdmins) {
            const tx = await governance.assignRole(admin, 2); // ADMIN_ROLE = 2
            await tx.wait();
            console.log(`Assigned admin role to ${admin}`);
        }

        // Setup operators
        for (const operator of deployConfig.initialOperators) {
            const tx = await governance.assignRole(operator, 1); // OPERATOR_ROLE = 1
            await tx.wait();
            console.log(`Assigned operator role to ${operator}`);
        }

        // Setup guardians
        for (const guardian of deployConfig.initialGuardians) {
            const tx = await governance.assignRole(guardian, 3); // GUARDIAN_ROLE = 3
            await tx.wait();
            console.log(`Assigned guardian role to ${guardian}`);
        }

        // Set signature threshold
        await governance.updateThreshold(deployConfig.requiredSignatures);
        console.log(`Set signature threshold to ${deployConfig.requiredSignatures}`);

        // Store deployment result
        const result: DeploymentResult = {
            network: networkName,
            chainId: network.config.chainId!,
            governance: governanceAddress,
            bridge: bridgeAddress,
            timestamp: Date.now()
        };

        // Save deployment information
        const deploymentDir = path.join(__dirname, '../../deployments', environment);
        if (!fs.existsSync(deploymentDir)) {
            fs.mkdirSync(deploymentDir, { recursive: true });
        }
        
        fs.writeFileSync(
            path.join(deploymentDir, `${networkName}.json`),
            JSON.stringify(result, null, 2)
        );

        // Verify contracts if configured
        if (deployConfig.verifyContracts && network.name !== "hardhat" && network.name !== "localhost") {
            console.log("Verifying contracts...");
            
            try {
                await run("verify:verify", {
                    address: governanceAddress,
                    constructorArguments: []
                });
                console.log("BridgeGovernance verified");
            } catch (error) {
                console.error("Error verifying BridgeGovernance:", error);
            }

            try {
                await run("verify:verify", {
                    address: bridgeAddress,
                    constructorArguments: [governanceAddress]
                });
                console.log("BridgeMirror verified");
            } catch (error) {
                console.error("Error verifying BridgeMirror:", error);
            }
        }

        console.log("Deployment completed successfully!");
        return result;

    } catch (error) {
        console.error("Deployment failed:", error);
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });