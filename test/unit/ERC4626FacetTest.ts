import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ERC4626Facet } from "../../typechain-types";

describe("ERC4626Facet", function () {
    async function deployERC4626Fixture() {
        const [owner, user1, user2] = await ethers.getSigners();
        
        // Deploy mock underlying token
        const MockToken = await ethers.getContractFactory("MyERC20Token");
        const underlying = await MockToken.deploy("Mock Token", "MTK");
        await underlying.deployed();

        // Deploy ERC4626Facet
        const ERC4626Factory = await ethers.getContractFactory("ERC4626Facet");
        const vault = await ERC4626Factory.deploy();
        await vault.deployed();

        // Initialize vault with underlying token
        await vault.initialize(underlying.address, "Vault Token", "vMTK");

        // Mint some tokens to users for testing
        await underlying.mint(user1.address, ethers.utils.parseEther("1000"));
        await underlying.mint(user2.address, ethers.utils.parseEther("1000"));

        return { vault, underlying, owner, user1, user2 };
    }

    describe("Vault Operations", function () {
        it("Should properly initialize with correct metadata", async function () {
            const { vault, underlying } = await loadFixture(deployERC4626Fixture);
            
            expect(await vault.name()).to.equal("Vault Token");
            expect(await vault.symbol()).to.equal("vMTK");
            expect(await vault.asset()).to.equal(underlying.address);
        });

        it("Should allow deposits and minting", async function () {
            const { vault, underlying, user1 } = await loadFixture(deployERC4626Fixture);
            const amount = ethers.utils.parseEther("100");

            await underlying.connect(user1).approve(vault.address, amount);
            await vault.connect(user1).deposit(amount, user1.address);

            expect(await vault.balanceOf(user1.address)).to.equal(amount);
            expect(await vault.totalAssets()).to.equal(amount);
        });

        it("Should handle withdrawals and redemptions correctly", async function () {
            const { vault, underlying, user1 } = await loadFixture(deployERC4626Fixture);
            const depositAmount = ethers.utils.parseEther("100");
            const withdrawAmount = ethers.utils.parseEther("50");

            await underlying.connect(user1).approve(vault.address, depositAmount);
            await vault.connect(user1).deposit(depositAmount, user1.address);
            
            const initialBalance = await underlying.balanceOf(user1.address);
            await vault.connect(user1).withdraw(withdrawAmount, user1.address, user1.address);

            expect(await underlying.balanceOf(user1.address)).to.equal(initialBalance.add(withdrawAmount));
            expect(await vault.totalAssets()).to.equal(depositAmount.sub(withdrawAmount));
        });

        it("Should calculate preview functions accurately", async function () {
            const { vault, underlying, user1 } = await loadFixture(deployERC4626Fixture);
            const amount = ethers.utils.parseEther("100");

            const previewDeposit = await vault.previewDeposit(amount);
            const previewMint = await vault.previewMint(amount);
            const previewWithdraw = await vault.previewWithdraw(amount);
            const previewRedeem = await vault.previewRedeem(amount);

            expect(previewDeposit).to.be.gt(0);
            expect(previewMint).to.be.gt(0);
            expect(previewWithdraw).to.be.gt(0);
            expect(previewRedeem).to.be.gt(0);
        });

        it("Should handle conversion between shares and assets correctly", async function() {
            const { vault, underlying, user1 } = await loadFixture(deployERC4626Fixture);
            const amount = ethers.utils.parseEther("100");

            await underlying.connect(user1).approve(vault.address, amount);
            await vault.connect(user1).deposit(amount, user1.address);

            const assets = await vault.convertToAssets(amount);
            const shares = await vault.convertToShares(amount);

            expect(assets).to.equal(amount);
            expect(shares).to.equal(amount);
        });
    });
});