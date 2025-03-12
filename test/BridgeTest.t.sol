// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/core/BridgeMirror.sol";
import "../contracts/governance/BridgeGovernance.sol";
import "../contracts/interfaces/IBridgeMirror.sol";

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

        // Deploy governance first
        vm.prank(owner);
        governance = new BridgeGovernance();
        
        // Deploy bridge with governance address
        bridge = new BridgeMirror(address(governance));

        // Setup initial roles in governance
        vm.startPrank(owner); // Use owner for setup
        governance.assignRole(admin1, IBridgeGovernance.Role.ADMIN);
        governance.assignRole(admin2, IBridgeGovernance.Role.ADMIN);
        governance.assignRole(operator, IBridgeGovernance.Role.OPERATOR);
        governance.assignRole(guardian, IBridgeGovernance.Role.GUARDIAN);

        // Set initial threshold in governance
        governance.updateThreshold(1); // Start with threshold 1 for simpler testing
        vm.stopPrank();
    }

    function test_RoleAssignment() public view {
        // Verify initial role assignments
        assertTrue(governance.hasRole(admin1, IBridgeGovernance.Role.ADMIN));
        assertTrue(governance.hasRole(admin2, IBridgeGovernance.Role.ADMIN));
        assertTrue(governance.hasRole(operator, IBridgeGovernance.Role.OPERATOR));
        assertTrue(governance.hasRole(guardian, IBridgeGovernance.Role.GUARDIAN));
    }

    function test_FeatureToggleWithGovernance() public {
        string memory feature = "TEST_FEATURE";

        // Toggle feature through governance
        vm.startPrank(admin1);
        bytes32 txHash = governance.proposeTransaction(
            address(bridge),
            0,
            abi.encodeWithSelector(bridge.toggleFeature.selector, feature, true)
        );
        governance.signTransaction(txHash);
        governance.executeTransaction(txHash);
        vm.stopPrank();

        assertTrue(bridge.isFeatureEnabled(feature));
    }

    function test_MirrorTransactionWithAuth() public {
        uint256 sourceChainId = 1;
        address sourceAddress = makeAddr("source");
        bytes32 transactionHash = keccak256("test");
        bytes memory data = hex"12345678";

        // Enable CROSS_CHAIN_MIRROR feature first
        vm.startPrank(admin1);
        bytes32 txHash = governance.proposeTransaction(
            address(bridge),
            0,
            abi.encodeWithSelector(bridge.toggleFeature.selector, "CROSS_CHAIN_MIRROR", true)
        );
        governance.signTransaction(txHash);
        governance.executeTransaction(txHash);
        vm.stopPrank();

        // Enable target chain
        vm.startPrank(admin1);
        txHash = governance.proposeTransaction(
            address(bridge),
            0,
            abi.encodeWithSelector(bridge.updateSupportedChain.selector, sourceChainId, true)
        );
        governance.signTransaction(txHash);
        governance.executeTransaction(txHash);
        vm.stopPrank();

        // Now test mirror transaction
        vm.prank(operator);
        vm.expectEmit(true, true, true, true);
        emit TransactionMirrored(sourceChainId, sourceAddress, transactionHash, data);
        bridge.mirrorTransaction(sourceChainId, sourceAddress, transactionHash, data);
    }

    function test_MultiSignatureRequirement() public {
        address target = makeAddr("target");
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

    function test_RevertWhen_UnauthorizedFeatureToggle() public {
        vm.prank(operator);
        vm.expectRevert();
        bridge.toggleFeature("TEST_FEATURE", true);
    }

    event TransactionMirrored(
        uint256 indexed sourceChainId,
        address indexed sourceAddress,
        bytes32 indexed transactionHash,
        bytes data
    );
}