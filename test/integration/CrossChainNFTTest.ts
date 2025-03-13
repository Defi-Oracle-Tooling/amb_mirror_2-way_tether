import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract, ContractRunner, Log } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MonitoringService } from "../../src/utils/MonitoringService";
import { BridgeService } from "../../src/services/BridgeService";
import { IBridgeMirror, IBridgeGovernance } from "../../typechain-types";

describe("Cross-Chain NFT Integration", function () {
    let sourceChainBridge: IBridgeMirror;
    let targetChainBridge: IBridgeMirror;
    let sourceChainGovernance: IBridgeGovernance;
    let targetChainGovernance: IBridgeGovernance;
    let owner: HardhatEthersSigner;
    let operators: HardhatEthersSigner[];
    let admins: HardhatEthersSigner[];
    let nftCollection: Contract;
    let nftCollection1155: Contract;

    before(async function () {
        [owner, ...operators] = await ethers.getSigners();
        admins = operators.slice(0, 2);
        operators = operators.slice(2, 4);

        // Deploy test NFT collections
        const ERC721Collection = await ethers.getContractFactory("MyERC721Token");
        nftCollection = await ERC721Collection.deploy("Test NFT", "TNFT");
        await nftCollection.waitForDeployment();

        const ERC1155Collection = await ethers.getContractFactory("MyERC1155Token");
        nftCollection1155 = await ERC1155Collection.deploy("https://test.uri/{id}");
        await nftCollection1155.waitForDeployment();

        // Deploy bridge contracts
        const BridgeGovernance = await ethers.getContractFactory("BridgeGovernance");
        sourceChainGovernance = await BridgeGovernance.deploy() as IBridgeGovernance;
        await sourceChainGovernance.waitForDeployment();

        const BridgeMirror = await ethers.getContractFactory("BridgeMirror");
        sourceChainBridge = await BridgeMirror.deploy(await sourceChainGovernance.getAddress()) as IBridgeMirror;
        await sourceChainBridge.waitForDeployment();

        targetChainGovernance = await BridgeGovernance.deploy() as IBridgeGovernance;
        await targetChainGovernance.waitForDeployment();

        targetChainBridge = await BridgeMirror.deploy(await targetChainGovernance.getAddress()) as IBridgeMirror;
        await targetChainBridge.waitForDeployment();

        // Setup roles
        await setupChainRoles(sourceChainGovernance);
        await setupChainRoles(targetChainGovernance);
    });

    async function setupChainRoles(governance: IBridgeGovernance) {
        const ADMIN_ROLE = 2;
        const OPERATOR_ROLE = 1;

        for (const admin of admins) {
            await governance.assignRole(admin.address, ADMIN_ROLE);
        }

        for (const operator of operators) {
            await governance.assignRole(operator.address, OPERATOR_ROLE);
        }

        await governance.updateThreshold(2);
    }

    describe("Cross-Chain NFT Transfer (ERC721)", function () {
        it("Should bridge NFTs between chains", async function () {
            const tokenId = 1;
            const targetChainId = 2;

            // Enable NFT bridging features
            await enableFeatureWithGovernance(sourceChainBridge, sourceChainGovernance, "NFT_BRIDGE", admins);
            await enableFeatureWithGovernance(targetChainBridge, targetChainGovernance, "NFT_BRIDGE", admins);

            // Register NFT collection on both chains
            await sourceChainBridge.connect(operators[0]).registerNFTCollection(nftCollection.getAddress());
            await targetChainBridge.connect(operators[0]).registerNFTCollection(nftCollection.getAddress());

            // Mint NFT
            await nftCollection.mint(operators[0].address, tokenId);
            await nftCollection.connect(operators[0]).approve(sourceChainBridge.getAddress(), tokenId);

            // Lock NFT on source chain
            const lockTx = await sourceChainBridge.connect(operators[0]).lockNFT(
                nftCollection.getAddress(),
                tokenId,
                targetChainId,
                operators[0].address
            );

            const lockReceipt = await lockTx.wait();
            const lockEvent = lockReceipt?.logs.find((e: Log) => {
                try {
                    const decoded = sourceChainBridge.interface.parseLog(e as any);
                    return decoded?.name === "NFTLocked";
                } catch {
                    return false;
                }
            });

            expect(lockEvent).to.not.be.undefined;
            const decodedLockEvent = sourceChainBridge.interface.parseLog(lockEvent as any);

            // Verify NFT ownership on source chain
            expect(await nftCollection.ownerOf(tokenId)).to.equal(sourceChainBridge.getAddress());

            // Mirror NFT on target chain
            const unlockTx = await targetChainBridge.connect(operators[0]).unlockNFT(
                nftCollection.getAddress(),
                tokenId,
                operators[0].address,
                decodedLockEvent.args.lockId
            );

            const unlockReceipt = await unlockTx.wait();
            const unlockEvent = unlockReceipt?.logs.find((e: Log) => {
                try {
                    const decoded = targetChainBridge.interface.parseLog(e as any);
                    return decoded?.name === "NFTUnlocked";
                } catch {
                    return false;
                }
            });

            expect(unlockEvent).to.not.be.undefined;
        });
    });

    describe("Cross-Chain NFT Transfer (ERC1155)", function () {
        it("Should bridge multiple NFTs between chains", async function () {
            const tokenId = 1;
            const amount = 5;
            const targetChainId = 2;

            // Register ERC1155 collection
            await sourceChainBridge.connect(operators[0]).registerNFTCollection(nftCollection1155.getAddress());
            await targetChainBridge.connect(operators[0]).registerNFTCollection(nftCollection1155.getAddress());

            // Mint NFTs
            await nftCollection1155.mint(operators[0].address, tokenId, amount, "0x");
            await nftCollection1155.connect(operators[0]).setApprovalForAll(sourceChainBridge.getAddress(), true);

            // Lock NFTs on source chain
            const lockTx = await sourceChainBridge.connect(operators[0]).lockNFT1155(
                nftCollection1155.getAddress(),
                tokenId,
                amount,
                targetChainId,
                operators[0].address
            );

            const lockReceipt = await lockTx.wait();
            const lockEvent = lockReceipt?.logs.find((e: Log) => {
                try {
                    const decoded = sourceChainBridge.interface.parseLog(e as any);
                    return decoded?.name === "NFT1155Locked";
                } catch {
                    return false;
                }
            });

            expect(lockEvent).to.not.be.undefined;
            const decodedLockEvent = sourceChainBridge.interface.parseLog(lockEvent as any);

            // Verify NFT balance on source chain
            expect(await nftCollection1155.balanceOf(sourceChainBridge.getAddress(), tokenId)).to.equal(amount);

            // Mirror NFTs on target chain
            const unlockTx = await targetChainBridge.connect(operators[0]).unlockNFT1155(
                nftCollection1155.getAddress(),
                tokenId,
                amount,
                operators[0].address,
                decodedLockEvent.args.lockId
            );

            const unlockReceipt = await unlockTx.wait();
            const unlockEvent = unlockReceipt?.logs.find((e: Log) => {
                try {
                    const decoded = targetChainBridge.interface.parseLog(e as any);
                    return decoded?.name === "NFT1155Unlocked";
                } catch {
                    return false;
                }
            });

            expect(unlockEvent).to.not.be.undefined;

            // Verify final balance
            expect(await nftCollection1155.balanceOf(operators[0].address, tokenId)).to.equal(amount);
        });

        it("Should handle batch transfers correctly", async function () {
            const tokenIds = [1, 2, 3];
            const amounts = [5, 10, 15];
            const targetChainId = 2;

            // Mint multiple NFTs
            for (let i = 0; i < tokenIds.length; i++) {
                await nftCollection1155.mint(operators[0].address, tokenIds[i], amounts[i], "0x");
            }
            await nftCollection1155.connect(operators[0]).setApprovalForAll(sourceChainBridge.getAddress(), true);

            // Lock batch on source chain
            const lockTx = await sourceChainBridge.connect(operators[0]).lockNFT1155Batch(
                nftCollection1155.getAddress(),
                tokenIds,
                amounts,
                targetChainId,
                operators[0].address
            );

            const lockReceipt = await lockTx.wait();
            const lockEvent = lockReceipt?.logs.find((e: Log) => {
                try {
                    const decoded = sourceChainBridge.interface.parseLog(e as any);
                    return decoded?.name === "NFT1155BatchLocked";
                } catch {
                    return false;
                }
            });

            expect(lockEvent).to.not.be.undefined;
            const decodedLockEvent = sourceChainBridge.interface.parseLog(lockEvent as any);

            // Verify balances on source chain
            for (let i = 0; i < tokenIds.length; i++) {
                expect(await nftCollection1155.balanceOf(sourceChainBridge.getAddress(), tokenIds[i]))
                    .to.equal(amounts[i]);
            }

            // Mirror batch on target chain
            const unlockTx = await targetChainBridge.connect(operators[0]).unlockNFT1155Batch(
                nftCollection1155.getAddress(),
                tokenIds,
                amounts,
                operators[0].address,
                decodedLockEvent.args.lockId
            );

            const unlockReceipt = await unlockTx.wait();
            const unlockEvent = unlockReceipt?.logs.find((e: Log) => {
                try {
                    const decoded = targetChainBridge.interface.parseLog(e as any);
                    return decoded?.name === "NFT1155BatchUnlocked";
                } catch {
                    return false;
                }
            });

            expect(unlockEvent).to.not.be.undefined;

            // Verify final balances
            for (let i = 0; i < tokenIds.length; i++) {
                expect(await nftCollection1155.balanceOf(operators[0].address, tokenIds[i]))
                    .to.equal(amounts[i]);
            }
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