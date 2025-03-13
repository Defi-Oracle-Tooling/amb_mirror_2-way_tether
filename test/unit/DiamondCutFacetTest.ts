import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { IDiamondCut } from "../../typechain-types";

describe("DiamondCutFacet", function () {
    async function deployDiamondFixture() {
        const [owner, user1, user2] = await ethers.getSigners();
        
        // Deploy test facets
        const TestFacet1 = await ethers.getContractFactory("ERC20Facet");
        const testFacet1 = await TestFacet1.deploy();
        await testFacet1.waitForDeployment();

        const TestFacet2 = await ethers.getContractFactory("ERC721Facet");
        const testFacet2 = await TestFacet2.deploy();
        await testFacet2.waitForDeployment();
        
        // Deploy DiamondCutFacet
        const DiamondCutFacet = await ethers.getContractFactory("DiamondCutFacet");
        const diamondCut = await DiamondCutFacet.deploy();
        await diamondCut.waitForDeployment();

        // Get facet function selectors
        const facet1Selectors = Object.keys(testFacet1.interface.functions).map(
            fn => testFacet1.interface.getFunction(fn).selector
        );
        
        const facet2Selectors = Object.keys(testFacet2.interface.functions).map(
            fn => testFacet2.interface.getFunction(fn).selector
        );

        return { 
            owner, 
            user1, 
            user2, 
            diamondCut, 
            testFacet1,
            testFacet2,
            facet1Selectors,
            facet2Selectors
        };
    }

    describe("Facet Management", function () {
        it("Should add new facets", async function () {
            const { diamondCut, testFacet1, facet1Selectors } = await loadFixture(deployDiamondFixture);
            
            const facetCuts = [{
                facetAddress: await testFacet1.getAddress(),
                action: 0, // Add
                functionSelectors: facet1Selectors
            }];

            await expect(diamondCut.diamondCut(facetCuts, ethers.ZeroAddress, "0x"))
                .to.emit(diamondCut, "DiamondCut")
                .withArgs(facetCuts, ethers.ZeroAddress, "0x");
        });

        it("Should replace existing facets", async function () {
            const { diamondCut, testFacet1, testFacet2, facet1Selectors } = 
                await loadFixture(deployDiamondFixture);
            
            // First add the original facet
            const addCuts = [{
                facetAddress: await testFacet1.getAddress(),
                action: 0, // Add
                functionSelectors: facet1Selectors
            }];
            
            await diamondCut.diamondCut(addCuts, ethers.ZeroAddress, "0x");

            // Then replace it
            const replaceCuts = [{
                facetAddress: await testFacet2.getAddress(),
                action: 1, // Replace
                functionSelectors: facet1Selectors
            }];

            await expect(diamondCut.diamondCut(replaceCuts, ethers.ZeroAddress, "0x"))
                .to.emit(diamondCut, "DiamondCut")
                .withArgs(replaceCuts, ethers.ZeroAddress, "0x");
        });

        it("Should remove facets", async function () {
            const { diamondCut, testFacet1, facet1Selectors } = await loadFixture(deployDiamondFixture);
            
            // First add the facet
            const addCuts = [{
                facetAddress: await testFacet1.getAddress(),
                action: 0, // Add
                functionSelectors: facet1Selectors
            }];
            
            await diamondCut.diamondCut(addCuts, ethers.ZeroAddress, "0x");

            // Then remove it
            const removeCuts = [{
                facetAddress: ethers.ZeroAddress,
                action: 2, // Remove
                functionSelectors: facet1Selectors
            }];

            await expect(diamondCut.diamondCut(removeCuts, ethers.ZeroAddress, "0x"))
                .to.emit(diamondCut, "DiamondCut")
                .withArgs(removeCuts, ethers.ZeroAddress, "0x");
        });
    });

    describe("Error Handling", function () {
        it("Should revert when adding duplicate selectors", async function () {
            const { diamondCut, testFacet1, facet1Selectors } = await loadFixture(deployDiamondFixture);
            
            const facetCuts = [{
                facetAddress: await testFacet1.getAddress(),
                action: 0, // Add
                functionSelectors: facet1Selectors
            }];

            // Add facet first time
            await diamondCut.diamondCut(facetCuts, ethers.ZeroAddress, "0x");

            // Try to add same selectors again
            await expect(
                diamondCut.diamondCut(facetCuts, ethers.ZeroAddress, "0x")
            ).to.be.revertedWith("LibDiamondCut: duplicate function selector");
        });

        it("Should revert when removing non-existent selectors", async function () {
            const { diamondCut, facet1Selectors } = await loadFixture(deployDiamondFixture);
            
            const removeCuts = [{
                facetAddress: ethers.ZeroAddress,
                action: 2, // Remove
                functionSelectors: facet1Selectors
            }];

            await expect(
                diamondCut.diamondCut(removeCuts, ethers.ZeroAddress, "0x")
            ).to.be.revertedWith("LibDiamondCut: function does not exist");
        });

        it("Should revert with invalid facet cut action", async function () {
            const { diamondCut, testFacet1, facet1Selectors } = await loadFixture(deployDiamondFixture);
            
            const invalidCuts = [{
                facetAddress: await testFacet1.getAddress(),
                action: 3, // Invalid action
                functionSelectors: facet1Selectors
            }];

            await expect(
                diamondCut.diamondCut(invalidCuts, ethers.ZeroAddress, "0x")
            ).to.be.revertedWith("LibDiamondCut: invalid facet cut action");
        });
    });

    describe("Initialization", function () {
        it("Should execute initialization function", async function () {
            const { diamondCut, testFacet1, facet1Selectors } = await loadFixture(deployDiamondFixture);
            
            // Create initialization data
            const initData = testFacet1.interface.encodeFunctionData("registerToken", [ethers.ZeroAddress]);
            
            const facetCuts = [{
                facetAddress: await testFacet1.getAddress(),
                action: 0, // Add
                functionSelectors: facet1Selectors
            }];

            await expect(
                diamondCut.diamondCut(facetCuts, await testFacet1.getAddress(), initData)
            ).to.emit(diamondCut, "DiamondCut")
             .withArgs(facetCuts, await testFacet1.getAddress(), initData);
        });

        it("Should revert if initialization fails", async function () {
            const { diamondCut, testFacet1, facet1Selectors } = await loadFixture(deployDiamondFixture);
            
            // Create invalid initialization data
            const invalidInitData = "0x1234";
            
            const facetCuts = [{
                facetAddress: await testFacet1.getAddress(),
                action: 0, // Add
                functionSelectors: facet1Selectors
            }];

            await expect(
                diamondCut.diamondCut(facetCuts, await testFacet1.getAddress(), invalidInitData)
            ).to.be.reverted;
        });
    });
});