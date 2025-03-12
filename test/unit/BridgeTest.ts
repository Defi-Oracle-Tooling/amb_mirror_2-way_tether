import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("Bridge System", function () {
  async function deployBridgeFixture() {
    const [owner, admin1, admin2, operator, guardian] = await ethers.getSigners();

    // Deploy Governance
    const BridgeGovernance = await ethers.getContractFactory("BridgeGovernance");
    const governance = await BridgeGovernance.deploy();
    await governance.deployed();

    // Deploy Bridge
    const BridgeMirror = await ethers.getContractFactory("BridgeMirror");
    const bridge = await BridgeMirror.deploy(governance.address);
    await bridge.deployed();

    // Setup roles
    const ADMIN_ROLE = 2; // From enum Role { NONE = 0, OPERATOR = 1, ADMIN = 2, GUARDIAN = 3 }
    const OPERATOR_ROLE = 1;
    const GUARDIAN_ROLE = 3;

    await governance.assignRole(admin1.address, ADMIN_ROLE);
    await governance.assignRole(admin2.address, ADMIN_ROLE);
    await governance.assignRole(operator.address, OPERATOR_ROLE);
    await governance.assignRole(guardian.address, GUARDIAN_ROLE);

    // Set initial threshold
    await governance.updateThreshold(2);

    return { 
      bridge, 
      governance, 
      owner, 
      admin1, 
      admin2, 
      operator, 
      guardian,
      ADMIN_ROLE,
      OPERATOR_ROLE,
      GUARDIAN_ROLE
    };
  }

  describe("Governance", function () {
    it("Should assign roles correctly", async function () {
      const { governance, admin1, ADMIN_ROLE } = await loadFixture(deployBridgeFixture);
      expect(await governance.hasRole(admin1.address, ADMIN_ROLE)).to.be.true;
    });

    it("Should require multiple signatures for critical operations", async function () {
      const { governance, admin1, admin2 } = await loadFixture(deployBridgeFixture);
      
      // Propose a transaction
      const target = ethers.constants.AddressZero;
      const value = 0;
      const data = "0x";
      
      const tx = await governance.connect(admin1).proposeTransaction(target, value, data);
      const receipt = await tx.wait();
      const txHash = receipt.events[0].args.txHash;

      // First signature
      await governance.connect(admin1).signTransaction(txHash);
      expect(await governance.getSignatureCount(txHash)).to.equal(1);

      // Second signature
      await governance.connect(admin2).signTransaction(txHash);
      expect(await governance.getSignatureCount(txHash)).to.equal(2);
    });
  });

  describe("Bridge", function () {
    it("Should mirror transactions when properly authorized", async function () {
      const { bridge, operator } = await loadFixture(deployBridgeFixture);
      
      const sourceChainId = 1;
      const sourceAddress = ethers.constants.AddressZero;
      const transactionHash = ethers.utils.formatBytes32String("test");
      const data = "0x";

      await expect(bridge.connect(operator).mirrorTransaction(
        sourceChainId,
        sourceAddress,
        transactionHash,
        data
      )).to.emit(bridge, "TransactionMirrored")
        .withArgs(sourceChainId, sourceAddress, transactionHash, data);
    });

    it("Should toggle features through governance", async function () {
      const { bridge, admin1, admin2, governance } = await loadFixture(deployBridgeFixture);
      
      const feature = "TEST_FEATURE";
      
      // Propose feature toggle
      const toggleData = bridge.interface.encodeFunctionData("toggleFeature", [feature, true]);
      const tx = await governance.connect(admin1).proposeTransaction(
        bridge.address,
        0,
        toggleData
      );
      const receipt = await tx.wait();
      const txHash = receipt.events[0].args.txHash;

      // Get required signatures
      await governance.connect(admin1).signTransaction(txHash);
      await governance.connect(admin2).signTransaction(txHash);

      // Execute the toggle
      await governance.connect(admin1).executeTransaction(txHash);

      expect(await bridge.isFeatureEnabled(feature)).to.be.true;
    });
  });
});