import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract, ContractRunner, Log } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MonitoringService } from "../../src/utils/MonitoringService";
import { BridgeService } from "../../src/services/BridgeService";
import { IBridgeMirror, IBridgeGovernance } from "../../typechain-types";

describe("Cross-Chain Token Locking Integration", function () {
    let sourceChainBridge: IBridgeMirror;
    let targetChainBridge: IBridgeMirror;
    let sourceChainGovernance: IBridgeGovernance;
    let targetChainGovernance: IBridgeGovernance;
    let owner: HardhatEthersSigner;
    let operators: HardhatEthersSigner[];
    let admins: HardhatEthersSigner[];
    let testToken: Contract;

    before(async function () {
        [owner, ...operators] = await ethers.getSigners();
        admins = operators.slice(0, 2);
        operators = operators.slice(2, 4);

        // Deploy test token
        const TestToken = await ethers.getContractFactory("MyERC20Token");
        testToken = await TestToken.deploy("Test Token", "TEST");
        await testToken.waitForDeployment();

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

    describe("Cross-Chain Token Locking", function () {
        it("Should lock tokens on source chain and unlock on target chain", async function () {
            const amount = ethers.parseEther("100");
            const sourceChainId = 1;
            const targetChainId = 2;

            // Enable required features
            await enableFeatureWithGovernance(sourceChainBridge, sourceChainGovernance, "TOKEN_LOCK", admins);
            await enableFeatureWithGovernance(targetChainBridge, targetChainGovernance, "TOKEN_LOCK", admins);

            // Register token on both chains
            await sourceChainBridge.connect(operators[0]).registerToken(testToken.getAddress());
            await targetChainBridge.connect(operators[0]).registerToken(testToken.getAddress());

            // Mint tokens to test account
            await testToken.mint(operators[0].address, amount);
            await testToken.connect(operators[0]).approve(sourceChainBridge.getAddress(), amount);

            // Lock tokens on source chain
            const lockTx = await sourceChainBridge.connect(operators[0]).lockTokens(
                testToken.getAddress(),
                amount,
                targetChainId,
                operators[0].address
            );

            const lockReceipt = await lockTx.wait();
            const lockEvent = lockReceipt?.logs.find((e: Log) => {
                try {
                    const decoded = sourceChainBridge.interface.parseLog(e as any);
                    return decoded?.name === "TokensLocked";
                } catch {
                    return false;
                }
            });

            expect(lockEvent).to.not.be.undefined;
            const decodedLockEvent = sourceChainBridge.interface.parseLog(lockEvent as any);

            // Verify tokens are locked on source chain
            expect(await testToken.balanceOf(sourceChainBridge.getAddress())).to.equal(amount);

            // Mirror the lock on target chain
            const unlockTx = await targetChainBridge.connect(operators[0]).unlockTokens(
                testToken.getAddress(),
                amount,
                operators[0].address,
                decodedLockEvent.args.lockId
            );

            const unlockReceipt = await unlockTx.wait();
            const unlockEvent = unlockReceipt?.logs.find((e: Log) => {
                try {
                    const decoded = targetChainBridge.interface.parseLog(e as any);
                    return decoded?.name === "TokensUnlocked";
                } catch {
                    return false;
                }
            });

            expect(unlockEvent).to.not.be.undefined;

            // Verify tokens are unlocked on target chain
            expect(await testToken.balanceOf(operators[0].address)).to.equal(amount);
        });

        it("Should handle failed token locks correctly", async function () {
            const amount = ethers.parseEther("100");
            const sourceChainId = 1;
            const targetChainId = 2;

            // Try to lock without enabling feature
            await expect(sourceChainBridge.connect(operators[0]).lockTokens(
                testToken.getAddress(),
                amount,
                targetChainId,
                operators[0].address
            )).to.be.revertedWith("Feature not enabled");

            // Try to lock without token registration
            await enableFeatureWithGovernance(sourceChainBridge, sourceChainGovernance, "TOKEN_LOCK", admins);
            await expect(sourceChainBridge.connect(operators[0]).lockTokens(
                ethers.ZeroAddress,
                amount,
                targetChainId,
                operators[0].address
            )).to.be.revertedWith("Token not registered");

            // Try to lock without sufficient balance
            const largeAmount = ethers.parseEther("1000000");
            await expect(sourceChainBridge.connect(operators[0]).lockTokens(
                testToken.getAddress(),
                largeAmount,
                targetChainId,
                operators[0].address
            )).to.be.revertedWith("Insufficient balance");
        });
    });

    async function enableFeatureWithGovernance(
        bridge: IBridgeMirror,
        governance: IBridgeGovernance,
        feature: string,
        admins: HardhatEthersSigner[]
    ) {
        const toggleData = bridge.interface.encodeFunctionData("toggleFeature", [feature, true]);
        const tx = await governance.connect(admins[0]).proposeTransaction(
            await bridge.getAddress(),
            0n,
            toggleData
        );
        const receipt = await tx.wait();
        const txHash = receipt!.logs[0].topics[1];

        for (const admin of admins) {
            await governance.connect(admin).signTransaction(txHash);
        }

        await governance.connect(admins[0]).executeTransaction(txHash);
    }
});