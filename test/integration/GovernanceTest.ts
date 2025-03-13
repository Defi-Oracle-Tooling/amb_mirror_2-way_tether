import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract, ContractRunner, Log } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { IBridgeMirror, IBridgeGovernance } from "../../typechain-types";

describe("Governance Integration", function () {
    let bridge: IBridgeMirror;
    let governance: IBridgeGovernance;
    let owner: HardhatEthersSigner;
    let operators: HardhatEthersSigner[];
    let admins: HardhatEthersSigner[];
    let guardians: HardhatEthersSigner[];

    before(async function () {
        [owner, ...operators] = await ethers.getSigners();
        admins = operators.slice(0, 2);
        operators = operators.slice(2, 4);
        guardians = operators.slice(4, 6);

        // Deploy contracts
        const BridgeGovernance = await ethers.getContractFactory("BridgeGovernance");
        governance = await BridgeGovernance.deploy() as IBridgeGovernance;
        await governance.waitForDeployment();

        const BridgeMirror = await ethers.getContractFactory("BridgeMirror");
        bridge = await BridgeMirror.deploy(await governance.getAddress()) as IBridgeMirror;
        await bridge.waitForDeployment();
    });

    describe("Role Management", function () {
        it("Should properly assign and verify roles", async function () {
            const ADMIN_ROLE = 2;
            const OPERATOR_ROLE = 1;
            const GUARDIAN_ROLE = 3;

            // Assign roles
            for (const admin of admins) {
                await governance.connect(owner).assignRole(admin.address, ADMIN_ROLE);
                expect(await governance.hasRole(admin.address, ADMIN_ROLE)).to.be.true;
            }

            for (const operator of operators) {
                await governance.connect(owner).assignRole(operator.address, OPERATOR_ROLE);
                expect(await governance.hasRole(operator.address, OPERATOR_ROLE)).to.be.true;
            }

            for (const guardian of guardians) {
                await governance.connect(owner).assignRole(guardian.address, GUARDIAN_ROLE);
                expect(await governance.hasRole(guardian.address, GUARDIAN_ROLE)).to.be.true;
            }

            // Verify role assignments
            for (const admin of admins) {
                expect(await governance.hasRole(admin.address, ADMIN_ROLE)).to.be.true;
                expect(await governance.hasRole(admin.address, OPERATOR_ROLE)).to.be.false;
                expect(await governance.hasRole(admin.address, GUARDIAN_ROLE)).to.be.false;
            }
        });

        it("Should enforce role-based access control", async function () {
            const INVALID_ROLE = 99;
            await expect(governance.connect(owner).assignRole(operators[0].address, INVALID_ROLE))
                .to.be.revertedWith("Invalid role");
                
            await expect(governance.connect(operators[0]).assignRole(admins[0].address, 1))
                .to.be.revertedWith("Unauthorized");
        });
    });

    describe("Multi-Signature Governance", function () {
        beforeEach(async function () {
            // Setup initial governance state
            await governance.updateThreshold(2); // Require 2 signatures
        });

        it("Should execute transaction with sufficient signatures", async function () {
            const feature = "TEST_FEATURE";
            const toggleData = bridge.interface.encodeFunctionData("toggleFeature", [feature, true]);
            
            // First admin proposes
            const proposeTx = await governance.connect(admins[0]).proposeTransaction(
                await bridge.getAddress(),
                0n,
                toggleData
            );
            
            const receipt = await proposeTx.wait();
            const txHash = receipt!.logs[0].topics[1];

            // Both admins sign
            await governance.connect(admins[0]).signTransaction(txHash);
            await governance.connect(admins[1]).signTransaction(txHash);

            // Execute
            await governance.connect(admins[0]).executeTransaction(txHash);

            // Verify feature was enabled
            expect(await bridge.isFeatureEnabled(feature)).to.be.true;
        });

        it("Should not execute with insufficient signatures", async function () {
            const feature = "ANOTHER_FEATURE";
            const toggleData = bridge.interface.encodeFunctionData("toggleFeature", [feature, true]);
            
            // First admin proposes
            const proposeTx = await governance.connect(admins[0]).proposeTransaction(
                await bridge.getAddress(),
                0n,
                toggleData
            );
            
            const receipt = await proposeTx.wait();
            const txHash = receipt!.logs[0].topics[1];

            // Only one admin signs
            await governance.connect(admins[0]).signTransaction(txHash);

            // Try to execute
            await expect(governance.connect(admins[0]).executeTransaction(txHash))
                .to.be.revertedWith("Insufficient signatures");
        });
    });

    describe("Guardian Functions", function () {
        it("Should allow guardians to pause bridge operations", async function () {
            // Enable guardian role
            await governance.connect(admins[0]).assignRole(guardians[0].address, 3); // GUARDIAN_ROLE

            // Guardian pauses bridge
            const pauseData = bridge.interface.encodeFunctionData("pause", []);
            const proposeTx = await governance.connect(guardians[0]).proposeTransaction(
                await bridge.getAddress(),
                0n,
                pauseData
            );
            
            const receipt = await proposeTx.wait();
            const txHash = receipt!.logs[0].topics[1];

            // Only guardian signature needed for emergency actions
            await governance.connect(guardians[0]).signTransaction(txHash);
            await governance.connect(guardians[0]).executeTransaction(txHash);

            // Verify bridge is paused
            expect(await bridge.isPaused()).to.be.true;
        });

        it("Should enforce timelock on non-emergency actions", async function () {
            const delay = 86400; // 1 day
            await governance.connect(admins[0]).updateTimelock(delay);

            const feature = "DELAYED_FEATURE";
            const toggleData = bridge.interface.encodeFunctionData("toggleFeature", [feature, true]);
            
            // Propose and sign
            const proposeTx = await governance.connect(admins[0]).proposeTransaction(
                await bridge.getAddress(),
                0n,
                toggleData
            );
            
            const receipt = await proposeTx.wait();
            const txHash = receipt!.logs[0].topics[1];

            await governance.connect(admins[0]).signTransaction(txHash);
            await governance.connect(admins[1]).signTransaction(txHash);

            // Try to execute immediately
            await expect(governance.connect(admins[0]).executeTransaction(txHash))
                .to.be.revertedWith("Timelock not expired");
        });
    });

    describe("Proposal Management", function () {
        it("Should track proposal lifecycle correctly", async function () {
            const feature = "TRACKED_FEATURE";
            const toggleData = bridge.interface.encodeFunctionData("toggleFeature", [feature, true]);
            
            // Propose transaction
            const proposeTx = await governance.connect(admins[0]).proposeTransaction(
                await bridge.getAddress(),
                0n,
                toggleData
            );
            
            const receipt = await proposeTx.wait();
            const txHash = receipt!.logs[0].topics[1];

            // Check initial state
            const proposal = await governance.getProposal(txHash);
            expect(proposal.executed).to.be.false;
            expect(proposal.signatureCount).to.equal(0);

            // Sign and verify count
            await governance.connect(admins[0]).signTransaction(txHash);
            expect((await governance.getProposal(txHash)).signatureCount).to.equal(1);

            await governance.connect(admins[1]).signTransaction(txHash);
            expect((await governance.getProposal(txHash)).signatureCount).to.equal(2);

            // Execute and verify final state
            await governance.connect(admins[0]).executeTransaction(txHash);
            expect((await governance.getProposal(txHash)).executed).to.be.true;
        });

        it("Should prevent double signing", async function () {
            const feature = "DOUBLE_SIGN_TEST";
            const toggleData = bridge.interface.encodeFunctionData("toggleFeature", [feature, true]);
            
            const proposeTx = await governance.connect(admins[0]).proposeTransaction(
                await bridge.getAddress(),
                0n,
                toggleData
            );
            
            const receipt = await proposeTx.wait();
            const txHash = receipt!.logs[0].topics[1];

            await governance.connect(admins[0]).signTransaction(txHash);
            await expect(governance.connect(admins[0]).signTransaction(txHash))
                .to.be.revertedWith("Already signed");
        });

        it("Should prevent executing already executed proposals", async function () {
            const feature = "DOUBLE_EXECUTE_TEST";
            const toggleData = bridge.interface.encodeFunctionData("toggleFeature", [feature, true]);
            
            const proposeTx = await governance.connect(admins[0]).proposeTransaction(
                await bridge.getAddress(),
                0n,
                toggleData
            );
            
            const receipt = await proposeTx.wait();
            const txHash = receipt!.logs[0].topics[1];

            await governance.connect(admins[0]).signTransaction(txHash);
            await governance.connect(admins[1]).signTransaction(txHash);
            
            await governance.connect(admins[0]).executeTransaction(txHash);
            await expect(governance.connect(admins[0]).executeTransaction(txHash))
                .to.be.revertedWith("Already executed");
        });
    });
});