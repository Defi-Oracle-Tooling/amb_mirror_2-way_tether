import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("ERC777Facet", function () {
    async function deployERC777Fixture() {
        const [owner, user1, user2] = await ethers.getSigners();
        
        // Deploy test token
        const TestToken = await ethers.getContractFactory("MyERC777Token");
        const defaultOperators = [owner.address];
        const testToken = await TestToken.deploy("Test Token", "TEST", defaultOperators);
        await testToken.deployed();
        
        // Deploy facet
        const ERC777Facet = await ethers.getContractFactory("ERC777Facet");
        const erc777Facet = await ERC777Facet.deploy();
        await erc777Facet.deployed();

        return { owner, user1, user2, testToken, erc777Facet };
    }

    describe("Token Registration", function () {
        it("Should register an ERC777 token", async function () {
            const { erc777Facet, testToken, owner } = await loadFixture(deployERC777Fixture);
            
            await expect(erc777Facet.registerToken(testToken.address))
                .to.emit(erc777Facet, "TokenRegistered")
                .withArgs(testToken.address);
                
            expect(await erc777Facet.isTokenRegistered(testToken.address)).to.be.true;
        });

        it("Should revert when registering non-ERC777 token", async function () {
            const { erc777Facet, owner } = await loadFixture(deployERC777Fixture);
            
            await expect(erc777Facet.registerToken(ethers.constants.AddressZero))
                .to.be.revertedWith("Invalid token address");
        });
    });

    describe("Token Operations", function () {
        it("Should lock tokens", async function () {
            const { erc777Facet, testToken, owner, user1 } = await loadFixture(deployERC777Fixture);
            const amount = ethers.utils.parseEther("100");
            
            await testToken.mint(user1.address, amount, "0x");
            await testToken.connect(user1).authorizeOperator(erc777Facet.address);
            await erc777Facet.registerToken(testToken.address);
            
            await expect(erc777Facet.connect(user1).lockTokens(testToken.address, amount))
                .to.emit(erc777Facet, "TokensLocked")
                .withArgs(testToken.address, user1.address, amount);
                
            expect(await testToken.balanceOf(erc777Facet.address)).to.equal(amount);
        });

        it("Should unlock tokens", async function () {
            const { erc777Facet, testToken, owner, user1 } = await loadFixture(deployERC777Fixture);
            const amount = ethers.utils.parseEther("100");
            
            await testToken.mint(user1.address, amount, "0x");
            await testToken.connect(user1).authorizeOperator(erc777Facet.address);
            await erc777Facet.registerToken(testToken.address);
            await erc777Facet.connect(user1).lockTokens(testToken.address, amount);
            
            await expect(erc777Facet.connect(user1).unlockTokens(testToken.address, amount))
                .to.emit(erc777Facet, "TokensUnlocked")
                .withArgs(testToken.address, user1.address, amount);
                
            expect(await testToken.balanceOf(user1.address)).to.equal(amount);
        });
    });

    describe("Cross-Chain Operations", function() {
        it("Should handle cross-chain token transfers", async function() {
            const { erc777Facet, testToken, user1, user2 } = await loadFixture(deployERC777Fixture);
            const amount = ethers.utils.parseEther("100");
            const targetChainId = 2;
            
            await testToken.mint(user1.address, amount, "0x");
            await testToken.connect(user1).authorizeOperator(erc777Facet.address);
            await erc777Facet.registerToken(testToken.address);
            
            await expect(erc777Facet.connect(user1).initiateTransfer(
                testToken.address,
                amount,
                targetChainId,
                user2.address,
                "0x"
            )).to.emit(erc777Facet, "TransferInitiated")
              .withArgs(testToken.address, user1.address, user2.address, amount, targetChainId);
        });
        
        it("Should handle cross-chain transfers with data", async function() {
            const { erc777Facet, testToken, user1, user2 } = await loadFixture(deployERC777Fixture);
            const amount = ethers.utils.parseEther("100");
            const targetChainId = 2;
            const data = ethers.utils.hexlify(ethers.utils.toUtf8Bytes("Transfer memo"));
            
            await testToken.mint(user1.address, amount, "0x");
            await testToken.connect(user1).authorizeOperator(erc777Facet.address);
            await erc777Facet.registerToken(testToken.address);
            
            await expect(erc777Facet.connect(user1).initiateTransfer(
                testToken.address,
                amount,
                targetChainId,
                user2.address,
                data
            )).to.emit(erc777Facet, "TransferInitiated")
              .withArgs(testToken.address, user1.address, user2.address, amount, targetChainId);
        });
    });

    describe("Operator Management", function() {
        it("Should respect operator authorization", async function() {
            const { erc777Facet, testToken, user1, user2 } = await loadFixture(deployERC777Fixture);
            const amount = ethers.utils.parseEther("100");
            
            await testToken.mint(user1.address, amount, "0x");
            await erc777Facet.registerToken(testToken.address);
            
            // Should fail without authorization
            await expect(erc777Facet.connect(user1).lockTokens(testToken.address, amount))
                .to.be.reverted;
                
            // Should succeed after authorization
            await testToken.connect(user1).authorizeOperator(erc777Facet.address);
            await expect(erc777Facet.connect(user1).lockTokens(testToken.address, amount))
                .to.emit(erc777Facet, "TokensLocked");
        });
    });
});