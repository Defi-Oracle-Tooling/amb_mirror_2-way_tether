import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { GlobalReserveUnit } from "../../typechain-types";

describe("GlobalReserveUnit", function () {
    async function deployGlobalReserveFixture() {
        const [owner, operator, user] = await ethers.getSigners();
        
        // Deploy ERC20Facet mock for testing
        const ERC20Facet = await ethers.getContractFactory("ERC20Facet");
        const erc20Facet = await ERC20Facet.deploy();
        await erc20Facet.deployed();

        // Deploy GlobalReserveUnit
        const GlobalReserveUnitFactory = await ethers.getContractFactory("GlobalReserveUnit");
        const globalReserve = await GlobalReserveUnitFactory.deploy(owner.address, erc20Facet.address);
        await globalReserve.deployed();

        // Setup operator role
        await globalReserve.grantRole(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("OPERATOR_ROLE")), operator.address);

        return { globalReserve, erc20Facet, owner, operator, user };
    }

    describe("Initialization and Access Control", function () {
        it("Should set correct initial roles", async function () {
            const { globalReserve, owner, operator } = await loadFixture(deployGlobalReserveFixture);
            
            const adminRole = await globalReserve.DEFAULT_ADMIN_ROLE();
            const operatorRole = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("OPERATOR_ROLE"));
            
            expect(await globalReserve.hasRole(adminRole, owner.address)).to.be.true;
            expect(await globalReserve.hasRole(operatorRole, operator.address)).to.be.true;
        });

        it("Should only allow operator to manage reserves", async function () {
            const { globalReserve, user } = await loadFixture(deployGlobalReserveFixture);
            
            await expect(globalReserve.connect(user).lockReserve(ethers.constants.AddressZero, 100))
                .to.be.revertedWith("AccessControl: missing role");
        });
    });

    describe("Reserve Management", function () {
        it("Should lock reserves correctly", async function () {
            const { globalReserve, operator } = await loadFixture(deployGlobalReserveFixture);
            const testToken = ethers.Wallet.createRandom().address;
            const amount = ethers.utils.parseEther("100");

            await globalReserve.connect(operator).lockReserve(testToken, amount);
            
            expect(await globalReserve.getLockedAmount(testToken)).to.equal(amount);
        });

        it("Should release reserves correctly", async function () {
            const { globalReserve, operator } = await loadFixture(deployGlobalReserveFixture);
            const testToken = ethers.Wallet.createRandom().address;
            const amount = ethers.utils.parseEther("100");

            await globalReserve.connect(operator).lockReserve(testToken, amount);
            await globalReserve.connect(operator).releaseReserve(testToken, amount);
            
            expect(await globalReserve.getLockedAmount(testToken)).to.equal(0);
        });

        it("Should not release more than locked amount", async function () {
            const { globalReserve, operator } = await loadFixture(deployGlobalReserveFixture);
            const testToken = ethers.Wallet.createRandom().address;
            const amount = ethers.utils.parseEther("100");

            await globalReserve.connect(operator).lockReserve(testToken, amount);
            
            await expect(globalReserve.connect(operator).releaseReserve(testToken, amount.mul(2)))
                .to.be.revertedWith("Insufficient locked amount");
        });

        it("Should track multiple tokens independently", async function () {
            const { globalReserve, operator } = await loadFixture(deployGlobalReserveFixture);
            const token1 = ethers.Wallet.createRandom().address;
            const token2 = ethers.Wallet.createRandom().address;
            const amount1 = ethers.utils.parseEther("100");
            const amount2 = ethers.utils.parseEther("200");

            await globalReserve.connect(operator).lockReserve(token1, amount1);
            await globalReserve.connect(operator).lockReserve(token2, amount2);

            expect(await globalReserve.getLockedAmount(token1)).to.equal(amount1);
            expect(await globalReserve.getLockedAmount(token2)).to.equal(amount2);
        });

        it("Should emit events on reserve changes", async function () {
            const { globalReserve, operator } = await loadFixture(deployGlobalReserveFixture);
            const testToken = ethers.Wallet.createRandom().address;
            const amount = ethers.utils.parseEther("100");

            await expect(globalReserve.connect(operator).lockReserve(testToken, amount))
                .to.emit(globalReserve, "ReserveLocked")
                .withArgs(testToken, amount);

            await expect(globalReserve.connect(operator).releaseReserve(testToken, amount))
                .to.emit(globalReserve, "ReserveReleased")
                .withArgs(testToken, amount);
        });
    });

    describe("Integration with ERC20Facet", function () {
        it("Should handle token transfers through ERC20Facet", async function () {
            const { globalReserve, erc20Facet, operator, user } = await loadFixture(deployGlobalReserveFixture);
            const amount = ethers.utils.parseEther("100");

            // Mock ERC20Facet behavior
            await erc20Facet.mint(user.address, amount);
            await erc20Facet.connect(user).approve(globalReserve.address, amount);

            // Lock reserves
            await globalReserve.connect(operator).lockReserve(erc20Facet.address, amount);
            
            expect(await globalReserve.getLockedAmount(erc20Facet.address)).to.equal(amount);
        });
    });
});