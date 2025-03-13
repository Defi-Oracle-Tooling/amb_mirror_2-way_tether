import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("ERC1155Facet", function () {
    async function deployERC1155Fixture() {
        const [owner, user1, user2] = await ethers.getSigners();
        
        // Deploy test token
        const TestToken = await ethers.getContractFactory("MyERC1155Token");
        const testToken = await TestToken.deploy("https://token-uri.com/{id}");
        await testToken.deployed();
        
        // Deploy facet
        const ERC1155Facet = await ethers.getContractFactory("ERC1155Facet");
        const erc1155Facet = await ERC1155Facet.deploy();
        await erc1155Facet.deployed();

        return { owner, user1, user2, testToken, erc1155Facet };
    }

    describe("Token Registration", function () {
        it("Should register an ERC1155 collection", async function () {
            const { erc1155Facet, testToken, owner } = await loadFixture(deployERC1155Fixture);
            
            await expect(erc1155Facet.registerCollection(testToken.address))
                .to.emit(erc1155Facet, "CollectionRegistered")
                .withArgs(testToken.address);
                
            expect(await erc1155Facet.isCollectionRegistered(testToken.address)).to.be.true;
        });

        it("Should revert when registering non-ERC1155 collection", async function () {
            const { erc1155Facet, owner } = await loadFixture(deployERC1155Fixture);
            
            await expect(erc1155Facet.registerCollection(ethers.constants.AddressZero))
                .to.be.revertedWith("Invalid collection address");
        });
    });

    describe("Token Operations", function () {
        it("Should lock tokens", async function () {
            const { erc1155Facet, testToken, owner, user1 } = await loadFixture(deployERC1155Fixture);
            const tokenId = 1;
            const amount = 100;
            
            await testToken.mint(user1.address, tokenId, amount, "0x");
            await testToken.connect(user1).setApprovalForAll(erc1155Facet.address, true);
            await erc1155Facet.registerCollection(testToken.address);
            
            await expect(erc1155Facet.connect(user1).lockTokens(testToken.address, tokenId, amount))
                .to.emit(erc1155Facet, "TokensLocked")
                .withArgs(testToken.address, user1.address, tokenId, amount);
                
            expect(await testToken.balanceOf(erc1155Facet.address, tokenId)).to.equal(amount);
        });

        it("Should unlock tokens", async function () {
            const { erc1155Facet, testToken, owner, user1 } = await loadFixture(deployERC1155Fixture);
            const tokenId = 1;
            const amount = 100;
            
            await testToken.mint(user1.address, tokenId, amount, "0x");
            await testToken.connect(user1).setApprovalForAll(erc1155Facet.address, true);
            await erc1155Facet.registerCollection(testToken.address);
            await erc1155Facet.connect(user1).lockTokens(testToken.address, tokenId, amount);
            
            await expect(erc1155Facet.connect(user1).unlockTokens(testToken.address, tokenId, amount))
                .to.emit(erc1155Facet, "TokensUnlocked")
                .withArgs(testToken.address, user1.address, tokenId, amount);
                
            expect(await testToken.balanceOf(user1.address, tokenId)).to.equal(amount);
        });

        it("Should handle batch operations", async function() {
            const { erc1155Facet, testToken, user1 } = await loadFixture(deployERC1155Fixture);
            const tokenIds = [1, 2, 3];
            const amounts = [100, 200, 300];
            
            // Mint multiple tokens
            await Promise.all(tokenIds.map((id, index) => 
                testToken.mint(user1.address, id, amounts[index], "0x")
            ));
            
            await testToken.connect(user1).setApprovalForAll(erc1155Facet.address, true);
            await erc1155Facet.registerCollection(testToken.address);
            
            await expect(erc1155Facet.connect(user1).lockBatch(
                testToken.address,
                tokenIds,
                amounts
            )).to.emit(erc1155Facet, "BatchLocked")
              .withArgs(testToken.address, user1.address, tokenIds, amounts);
              
            // Verify balances
            for (let i = 0; i < tokenIds.length; i++) {
                expect(await testToken.balanceOf(erc1155Facet.address, tokenIds[i]))
                    .to.equal(amounts[i]);
            }
        });
    });

    describe("Cross-Chain Operations", function() {
        it("Should handle cross-chain token transfers", async function() {
            const { erc1155Facet, testToken, user1, user2 } = await loadFixture(deployERC1155Fixture);
            const tokenId = 1;
            const amount = 100;
            const targetChainId = 2;
            
            await testToken.mint(user1.address, tokenId, amount, "0x");
            await testToken.connect(user1).setApprovalForAll(erc1155Facet.address, true);
            await erc1155Facet.registerCollection(testToken.address);
            
            await expect(erc1155Facet.connect(user1).initiateTransfer(
                testToken.address,
                tokenId,
                amount,
                targetChainId,
                user2.address
            )).to.emit(erc1155Facet, "TransferInitiated")
              .withArgs(testToken.address, user1.address, user2.address, tokenId, amount, targetChainId);
        });

        it("Should handle cross-chain batch transfers", async function() {
            const { erc1155Facet, testToken, user1, user2 } = await loadFixture(deployERC1155Fixture);
            const tokenIds = [1, 2, 3];
            const amounts = [100, 200, 300];
            const targetChainId = 2;
            
            // Mint multiple tokens
            await Promise.all(tokenIds.map((id, index) => 
                testToken.mint(user1.address, id, amounts[index], "0x")
            ));
            
            await testToken.connect(user1).setApprovalForAll(erc1155Facet.address, true);
            await erc1155Facet.registerCollection(testToken.address);
            
            await expect(erc1155Facet.connect(user1).initiateBatchTransfer(
                testToken.address,
                tokenIds,
                amounts,
                targetChainId,
                user2.address
            )).to.emit(erc1155Facet, "BatchTransferInitiated")
              .withArgs(testToken.address, user1.address, user2.address, tokenIds, amounts, targetChainId);
        });
    });
});