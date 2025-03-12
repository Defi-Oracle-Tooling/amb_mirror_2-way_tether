// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/core/BridgeMirror.sol";
import "../contracts/governance/BridgeGovernance.sol";

contract BridgeTest is Test {
    BridgeMirror public bridge;
    BridgeGovernance public governance;
    address public owner;
    address public admin1;
    address public admin2;
    address public operator;
    address public guardian;

    function setUp() public {
        owner = address(this);
        admin1 = makeAddr("admin1");
        admin2 = makeAddr("admin2");
        operator = makeAddr("operator");
        guardian = makeAddr("guardian");

        // Deploy contracts
        governance = new BridgeGovernance();
        bridge = new BridgeMirror(address(governance));

        // Setup roles
        governance.assignRole(admin1, IBridgeGovernance.Role.ADMIN);
        governance.assignRole(admin2, IBridgeGovernance.Role.ADMIN);
        governance.assignRole(operator, IBridgeGovernance.Role.OPERATOR);
        governance.assignRole(guardian, IBridgeGovernance.Role.GUARDIAN);

        // Set threshold
        governance.updateThreshold(2);
    }

    function test_RoleAssignment() public {
        assertTrue(governance.hasRole(admin1, IBridgeGovernance.Role.ADMIN));
    }

    function test_MultiSignatureRequirement() public {
        address target = address(0);
        uint256 value = 0;
        bytes memory data = "";

        vm.startPrank(admin1);
        bytes32 txHash = governance.proposeTransaction(target, value, data);
        governance.signTransaction(txHash);
        vm.stopPrank();

        assertEq(governance.getSignatureCount(txHash), 1);

        vm.prank(admin2);
        governance.signTransaction(txHash);
        assertEq(governance.getSignatureCount(txHash), 2);
    }

    function test_MirrorTransactionWithAuth() public {
        uint256 sourceChainId = 1;
        address sourceAddress = address(0);
        bytes32 transactionHash = keccak256("test");
        bytes memory data = "";

        vm.prank(operator);
        vm.expectEmit(true, true, true, true);
        emit IBridgeMirror.TransactionMirrored(sourceChainId, sourceAddress, transactionHash, data);
        bridge.mirrorTransaction(sourceChainId, sourceAddress, transactionHash, data);
    }

    function test_FeatureToggleWithGovernance() public {
        string memory feature = "TEST_FEATURE";
        bytes memory toggleData = abi.encodeWithSelector(
            bridge.toggleFeature.selector,
            feature,
            true
        );

        vm.startPrank(admin1);
        bytes32 txHash = governance.proposeTransaction(
            address(bridge),
            0,
            toggleData
        );
        governance.signTransaction(txHash);
        vm.stopPrank();

        vm.prank(admin2);
        governance.signTransaction(txHash);

        vm.prank(admin1);
        governance.executeTransaction(txHash);

        assertTrue(bridge.isFeatureEnabled(feature));
    }

    function testFail_UnauthorizedFeatureToggle() public {
        vm.prank(operator);
        bridge.toggleFeature("TEST_FEATURE", true);
    }
}