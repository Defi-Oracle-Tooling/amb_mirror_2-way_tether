import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("ERC721Facet", function () {
    async function deployERC721Fixture() {
        const [owner, user1, user2] = await ethers.getSigners();
        
        // Deploy test token
        const TestToken = await ethers.getContractFactory("MyERC721Token");
        const testToken = await TestToken.deploy("Test NFT", "TNFT");
        await testToken.deployed();
        
        // Deploy facet
        const ERC721Facet = await ethers.getContractFactory("ERC721Facet");
        const erc721Facet = await ERC721Facet.deploy();
        await erc721Facet.deployed();

        return { owner, user1, user2, testToken, erc721Facet };
    }

    describe("NFT Registration", function () {
        it("Should register an ERC721 collection", async function () {
            const { erc721Facet, testToken, owner } = await loadFixture(deployERC721Fixture);
            
            await expect(erc721Facet.registerCollection(testToken.address))
                .to.emit(erc721Facet, "CollectionRegistered")
                .withArgs(testToken.address);
                
            expect(await erc721Facet.isCollectionRegistered(testToken.address)).to.be.true;
        });

        it("Should revert when registering non-ERC721 collection", async function () {
            const { erc721Facet, owner } = await loadFixture(deployERC721Fixture);
            
            await expect(erc721Facet.registerCollection(ethers.constants.AddressZero))
                .to.be.revertedWith("Invalid collection address");
        });
    });

    describe("NFT Operations", function () {
        it("Should lock NFT", async function () {
            const { erc721Facet, testToken, owner, user1 } = await loadFixture(deployERC721Fixture);
            const tokenId = 1;
            
            await testToken.mint(user1.address, tokenId);
            await testToken.connect(user1).approve(erc721Facet.address, tokenId);
            await erc721Facet.registerCollection(testToken.address);
            
            await expect(erc721Facet.connect(user1).lockNFT(testToken.address, tokenId))
                .to.emit(erc721Facet, "NFTLocked")
                .withArgs(testToken.address, user1.address, tokenId);
                
            expect(await testToken.ownerOf(tokenId)).to.equal(erc721Facet.address);
        });

        it("Should unlock NFT", async function () {
            const { erc721Facet, testToken, owner, user1 } = await loadFixture(deployERC721Fixture);
            const tokenId = 1;
            
            await testToken.mint(user1.address, tokenId);
            await testToken.connect(user1).approve(erc721Facet.address, tokenId);
            await erc721Facet.registerCollection(testToken.address);
            await erc721Facet.connect(user1).lockNFT(testToken.address, tokenId);
            
            await expect(erc721Facet.connect(user1).unlockNFT(testToken.address, tokenId))
                .to.emit(erc721Facet, "NFTUnlocked")
                .withArgs(testToken.address, user1.address, tokenId);
                
            expect(await testToken.ownerOf(tokenId)).to.equal(user1.address);
        });
    });

    describe("Cross-Chain Operations", function() {
        it("Should handle cross-chain NFT transfers", async function() {
            const { erc721Facet, testToken, user1, user2 } = await loadFixture(deployERC721Fixture);
            const tokenId = 1;
            const targetChainId = 2;
            
            await testToken.mint(user1.address, tokenId);
            await testToken.connect(user1).approve(erc721Facet.address, tokenId);
            await erc721Facet.registerCollection(testToken.address);
            
            await expect(erc721Facet.connect(user1).initiateTransfer(
                testToken.address,
                tokenId,
                targetChainId,
                user2.address
            )).to.emit(erc721Facet, "TransferInitiated")
              .withArgs(testToken.address, user1.address, user2.address, tokenId, targetChainId);
        });

        it("Should handle batch transfers", async function() {
            const { erc721Facet, testToken, user1, user2 } = await loadFixture(deployERC721Fixture);
            const tokenIds = [1, 2, 3];
            const targetChainId = 2;
            
            // Mint multiple NFTs
            for (const tokenId of tokenIds) {
                await testToken.mint(user1.address, tokenId);
                await testToken.connect(user1).approve(erc721Facet.address, tokenId);
            }
            
            await erc721Facet.registerCollection(testToken.address);
            
            await expect(erc721Facet.connect(user1).initiateBatchTransfer(
                testToken.address,
                tokenIds,
                targetChainId,
                user2.address
            )).to.emit(erc721Facet, "BatchTransferInitiated")
              .withArgs(testToken.address, user1.address, user2.address, tokenIds, targetChainId);
        });
    });
});