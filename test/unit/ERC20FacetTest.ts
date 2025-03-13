import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("ERC20Facet", function () {
    async function deployERC20Fixture() {
        const [owner, user1, user2] = await ethers.getSigners();
        
        // Deploy test token
        const TestToken = await ethers.getContractFactory("MyERC20Token");
        const testToken = await TestToken.deploy("Test Token", "TEST");
        await testToken.deployed();
        
        // Deploy facet
        const ERC20Facet = await ethers.getContractFactory("ERC20Facet");
        const erc20Facet = await ERC20Facet.deploy();
        await erc20Facet.deployed();

        return { owner, user1, user2, testToken, erc20Facet };
    }

    describe("Token Registration", function () {
        it("Should register an ERC20 token", async function () {
            const { erc20Facet, testToken, owner } = await loadFixture(deployERC20Fixture);
            
            await expect(erc20Facet.registerToken(testToken.address))
                .to.emit(erc20Facet, "TokenRegistered")
                .withArgs(testToken.address);
                
            expect(await erc20Facet.isTokenRegistered(testToken.address)).to.be.true;
        });

        it("Should revert when registering non-ERC20 token", async function () {
            const { erc20Facet, owner } = await loadFixture(deployERC20Fixture);
            
            await expect(erc20Facet.registerToken(ethers.constants.AddressZero))
                .to.be.revertedWith("Invalid token address");
        });
    });

    describe("Token Operations", function () {
        it("Should lock tokens", async function () {
            const { erc20Facet, testToken, owner, user1 } = await loadFixture(deployERC20Fixture);
            const amount = ethers.utils.parseEther("100");
            
            await testToken.mint(user1.address, amount);
            await testToken.connect(user1).approve(erc20Facet.address, amount);
            await erc20Facet.registerToken(testToken.address);
            
            await expect(erc20Facet.connect(user1).lockTokens(testToken.address, amount))
                .to.emit(erc20Facet, "TokensLocked")
                .withArgs(testToken.address, user1.address, amount);
                
            expect(await testToken.balanceOf(erc20Facet.address)).to.equal(amount);
        });

        it("Should unlock tokens", async function () {
            const { erc20Facet, testToken, owner, user1 } = await loadFixture(deployERC20Fixture);
            const amount = ethers.utils.parseEther("100");
            
            await testToken.mint(user1.address, amount);
            await testToken.connect(user1).approve(erc20Facet.address, amount);
            await erc20Facet.registerToken(testToken.address);
            await erc20Facet.connect(user1).lockTokens(testToken.address, amount);
            
            await expect(erc20Facet.connect(user1).unlockTokens(testToken.address, amount))
                .to.emit(erc20Facet, "TokensUnlocked")
                .withArgs(testToken.address, user1.address, amount);
                
            expect(await testToken.balanceOf(user1.address)).to.equal(amount);
        });
    });

    describe("Cross-Chain Operations", function() {
        it("Should handle cross-chain token transfers", async function() {
            const { erc20Facet, testToken, user1, user2 } = await loadFixture(deployERC20Fixture);
            const amount = ethers.utils.parseEther("100");
            const targetChainId = 2;
            
            await testToken.mint(user1.address, amount);
            await testToken.connect(user1).approve(erc20Facet.address, amount);
            await erc20Facet.registerToken(testToken.address);
            
            await expect(erc20Facet.connect(user1).initiateTransfer(
                testToken.address,
                amount,
                targetChainId,
                user2.address
            )).to.emit(erc20Facet, "TransferInitiated")
              .withArgs(testToken.address, user1.address, user2.address, amount, targetChainId);
        });
    });
});