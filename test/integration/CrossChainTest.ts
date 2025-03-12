import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract, ContractRunner, Log } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MonitoringService, AlertLevel } from "../../src/utils/MonitoringService";
import { BridgeService } from "../../src/services/BridgeService";
import { BridgeMirror, BridgeGovernance } from "../../typechain-types";

describe("Cross-Chain Integration", function () {
    let sourceChainBridge: IBridgeMirror;
    let targetChainBridge: IBridgeMirror;
    let sourceChainGovernance: IBridgeGovernance;
    let targetChainGovernance: IBridgeGovernance;
    let owner: HardhatEthersSigner;
    let operators: HardhatEthersSigner[];
    let admins: HardhatEthersSigner[];

    before(async function () {
        [owner, ...operators] = await ethers.getSigners();
        admins = operators.slice(0, 2);
        operators = operators.slice(2, 4);

        // Deploy contracts for source chain
        const BridgeGovernance = await ethers.getContractFactory("BridgeGovernance");
        sourceChainGovernance = await BridgeGovernance.deploy() as IBridgeGovernance;
        await sourceChainGovernance.waitForDeployment();

        const BridgeMirror = await ethers.getContractFactory("BridgeMirror");
        sourceChainBridge = await BridgeMirror.deploy(await sourceChainGovernance.getAddress()) as IBridgeMirror;
        await sourceChainBridge.waitForDeployment();

        // Deploy contracts for target chain
        targetChainGovernance = await BridgeGovernance.deploy() as IBridgeGovernance;
        await targetChainGovernance.waitForDeployment();

        targetChainBridge = await BridgeMirror.deploy(await targetChainGovernance.getAddress()) as IBridgeMirror;
        await targetChainBridge.waitForDeployment();

        // Setup roles and configuration
        await setupChainRoles(sourceChainGovernance);
        await setupChainRoles(targetChainGovernance);
    });

    async function setupChainRoles(governance: IBridgeGovernance) {
        const ADMIN_ROLE = 2;
        const OPERATOR_ROLE = 1;

        // Assign admin roles
        for (const admin of admins) {
            await governance.assignRole(admin.address, ADMIN_ROLE);
        }

        // Assign operator roles
        for (const operator of operators) {
            await governance.assignRole(operator.address, OPERATOR_ROLE);
        }

        // Set threshold for multi-sig
        await governance.updateThreshold(2);
    }

    describe("Cross-Chain Transaction Mirroring", function () {
        it("Should successfully mirror transactions across chains", async function () {
            const sourceChainId = 1;
            const targetChainId = 2;
            const testData = ethers.AbiCoder.defaultAbiCoder().encode(
                ["string", "uint256"],
                ["test_action", 123]
            );

            // Enable required features on both chains
            await enableFeatureWithGovernance(
                sourceChainBridge,
                sourceChainGovernance,
                "CROSS_CHAIN_MIRROR",
                admins
            );
            
            await enableFeatureWithGovernance(
                targetChainBridge,
                targetChainGovernance,
                "CROSS_CHAIN_MIRROR",
                admins
            );

            // Initiate transaction on source chain
            const bridgeWithSigner = sourceChainBridge.connect(operators[0]) as IBridgeMirror;
            const tx = await bridgeWithSigner.mirrorTransaction(
                targetChainId,
                operators[0].address,
                ethers.encodeBytes32String("test_tx"),
                testData
            );

            const receipt = await tx.wait();
            const event = receipt?.logs.find((e: Log) => {
                try {
                    const decoded = bridgeWithSigner.interface.parseLog(e);
                    return decoded?.name === "TransactionMirrored";
                } catch {
                    return false;
                }
            });
            const decodedEvent = event ? bridgeWithSigner.interface.parseLog(event) : null;
            expect(decodedEvent).to.not.be.undefined;

            // Verify transaction was mirrored on target chain
            const targetBridgeWithSigner = targetChainBridge.connect(operators[0]) as IBridgeMirror;
            const mirroredTx = await targetBridgeWithSigner.mirrorTransaction(
                sourceChainId,
                decodedEvent!.args.sourceAddress,
                decodedEvent!.args.transactionHash,
                decodedEvent!.args.data
            );

            const mirroredReceipt = await mirroredTx.wait();
            const mirroredEvent = mirroredReceipt?.logs.find((e: Log) => {
                try {
                    const decoded = targetBridgeWithSigner.interface.parseLog(e);
                    return decoded?.name === "TransactionMirrored";
                } catch {
                    return false;
                }
            });
            const decodedMirroredEvent = mirroredEvent ? targetBridgeWithSigner.interface.parseLog(mirroredEvent) : null;
            expect(decodedMirroredEvent).to.not.be.undefined;
            expect(decodedMirroredEvent!.args.data).to.equal(testData);
        });
    });

    async function enableFeatureWithGovernance(
        bridge: IBridgeMirror,
        governance: IBridgeGovernance,
        feature: string,
        admins: HardhatEthersSigner[]
    ) {
        const toggleData = bridge.interface.encodeFunctionData("toggleFeature", [feature, true]);
        const govWithSigner = governance.connect(admins[0]) as IBridgeGovernance;
        const tx = await govWithSigner.proposeTransaction(
            await bridge.getAddress(),
            0n,
            toggleData
        );
        const receipt = await tx.wait();
        const txHash = receipt!.logs[0].topics[1];

        // Get required signatures
        for (const admin of admins) {
            await governance.connect(admin).signTransaction(txHash);
        }

        // Execute the toggle
        await governance.connect(admins[0]).executeTransaction(txHash);
    }
});