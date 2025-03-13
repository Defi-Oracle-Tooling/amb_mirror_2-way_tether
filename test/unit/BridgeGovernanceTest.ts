import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { BridgeGovernance } from "../../typechain-types";

describe("BridgeGovernance", function () {
    async function deployGovernanceFixture() {
        const [owner, admin1, admin2, admin3, operator, user] = await ethers.getSigners();
        
        const BridgeGovernance = await ethers.getContractFactory("BridgeGovernance");
        const governance = await BridgeGovernance.deploy();
        await governance.deployed();

        // Setup roles
        const ADMIN_ROLE = 2; // From Role enum
        await governance.assignRole(admin1.address, ADMIN_ROLE);
        await governance.assignRole(admin2.address, ADMIN_ROLE);
        await governance.assignRole(admin3.address, ADMIN_ROLE);
        
        // Set initial threshold
        await governance.updateThreshold(2); // Require 2 signatures

        return { governance, owner, admin1, admin2, admin3, operator, user };
    }

    describe("Role Management", function () {
        it("Should assign and revoke roles correctly", async function () {
            const { governance, owner, user } = await loadFixture(deployGovernanceFixture);
            const OPERATOR_ROLE = 1;

            await governance.assignRole(user.address, OPERATOR_ROLE);
            expect(await governance.hasRole(user.address, OPERATOR_ROLE)).to.be.true;

            await governance.revokeRole(user.address, OPERATOR_ROLE);
            expect(await governance.hasRole(user.address, OPERATOR_ROLE)).to.be.false;
        });

        it("Should only allow owner to manage roles", async function () {
            const { governance, user } = await loadFixture(deployGovernanceFixture);
            const OPERATOR_ROLE = 1;

            await expect(governance.connect(user).assignRole(user.address, OPERATOR_ROLE))
                .to.be.revertedWith("Not authorized");
        });
    });

    describe("Transaction Proposal and Execution", function () {
        it("Should propose and execute transaction with sufficient signatures", async function () {
            const { governance, admin1, admin2, user } = await loadFixture(deployGovernanceFixture);
            
            const target = user.address;
            const value = ethers.utils.parseEther("1");
            const data = "0x";

            // Propose transaction
            await governance.connect(admin1).proposeTransaction(target, value, data);
            const txHash = ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(
                    ["address", "uint256", "bytes"],
                    [target, value, data]
                )
            );

            // Sign transaction
            await governance.connect(admin1).signTransaction(txHash);
            await governance.connect(admin2).signTransaction(txHash);

            // Execute transaction
            await governance.connect(admin1).executeTransaction(txHash);

            // Verify execution
            expect(await governance.isExecuted(txHash)).to.be.true;
        });

        it("Should not execute without sufficient signatures", async function () {
            const { governance, admin1, user } = await loadFixture(deployGovernanceFixture);
            
            const target = user.address;
            const value = ethers.utils.parseEther("1");
            const data = "0x";

            await governance.connect(admin1).proposeTransaction(target, value, data);
            const txHash = ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(
                    ["address", "uint256", "bytes"],
                    [target, value, data]
                )
            );

            await governance.connect(admin1).signTransaction(txHash);

            await expect(governance.connect(admin1).executeTransaction(txHash))
                .to.be.revertedWith("Insufficient signatures");
        });

        it("Should not allow double signing", async function () {
            const { governance, admin1, user } = await loadFixture(deployGovernanceFixture);
            
            const target = user.address;
            const value = ethers.utils.parseEther("1");
            const data = "0x";

            await governance.connect(admin1).proposeTransaction(target, value, data);
            const txHash = ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(
                    ["address", "uint256", "bytes"],
                    [target, value, data]
                )
            );

            await governance.connect(admin1).signTransaction(txHash);
            
            await expect(governance.connect(admin1).signTransaction(txHash))
                .to.be.revertedWith("Already signed");
        });

        it("Should not execute same transaction twice", async function () {
            const { governance, admin1, admin2, user } = await loadFixture(deployGovernanceFixture);
            
            const target = user.address;
            const value = ethers.utils.parseEther("1");
            const data = "0x";

            await governance.connect(admin1).proposeTransaction(target, value, data);
            const txHash = ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(
                    ["address", "uint256", "bytes"],
                    [target, value, data]
                )
            );

            await governance.connect(admin1).signTransaction(txHash);
            await governance.connect(admin2).signTransaction(txHash);
            await governance.connect(admin1).executeTransaction(txHash);

            await expect(governance.connect(admin1).executeTransaction(txHash))
                .to.be.revertedWith("Already executed");
        });
    });

    describe("Threshold Management", function () {
        it("Should update signature threshold correctly", async function () {
            const { governance } = await loadFixture(deployGovernanceFixture);
            
            await governance.updateThreshold(3);
            expect(await governance.getThreshold()).to.equal(3);
        });

        it("Should validate threshold constraints", async function () {
            const { governance } = await loadFixture(deployGovernanceFixture);
            
            await expect(governance.updateThreshold(0))
                .to.be.revertedWith("Invalid threshold");
            
            await expect(governance.updateThreshold(10))
                .to.be.revertedWith("Invalid threshold");
        });
    });
});