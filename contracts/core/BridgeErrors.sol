// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library BridgeErrors {
    // Role-based errors
    error UnauthorizedRole(address account, uint8 requiredRole);
    error InvalidRoleAssignment(address account, uint8 role);
    error CannotRevokeOwnRole(address account);

    // Transaction-related errors
    error TransactionAlreadyProcessed(bytes32 txHash);
    error TransactionDoesNotExist(bytes32 txHash);
    error TransactionAlreadyExecuted(bytes32 txHash);
    error InsufficientSignatures(bytes32 txHash, uint256 current, uint256 required);
    error InvalidTransactionData(bytes32 txHash, string reason);
    error TransactionExecutionFailed(bytes32 txHash, bytes reason);

    // Chain-related errors
    error UnsupportedChain(uint256 chainId);
    error InvalidSourceChain(uint256 chainId);
    error InvalidTargetChain(uint256 chainId);

    // Configuration errors
    error FeatureNotEnabled(string feature);
    error InvalidThresholdUpdate(uint256 current, uint256 proposed, uint256 signers);
    error InvalidSignerUpdate(address signer, string reason);
    error InvalidGovernanceAddress(address provided);

    // System state errors
    error SystemPaused();
    error InvalidStateTransition(string current, string proposed);

    // Helper functions to create standardized error messages
    function getUnauthorizedRoleError(address account, uint8 requiredRole) internal pure returns (string memory) {
        return string(abi.encodePacked(
            "Account ", addressToString(account), 
            " does not have required role ", uint8ToString(requiredRole)
        ));
    }

    function getTransactionError(bytes32 txHash, string memory reason) internal pure returns (string memory) {
        return string(abi.encodePacked(
            "Transaction ", bytes32ToString(txHash),
            " error: ", reason
        ));
    }

    // Utility functions for error message formatting
    function addressToString(address account) internal pure returns (string memory) {
        bytes memory s = new bytes(40);
        for (uint i = 0; i < 20; i++) {
            bytes1 b = bytes1(uint8(uint(uint160(account)) / (2**(8*(19 - i)))));
            bytes1 hi = bytes1(uint8(b) / 16);
            bytes1 lo = bytes1(uint8(b) - 16 * uint8(hi));
            s[2*i] = char(hi);
            s[2*i+1] = char(lo);            
        }
        return string(abi.encodePacked("0x", string(s)));
    }

    function bytes32ToString(bytes32 value) internal pure returns (string memory) {
        bytes memory s = new bytes(64);
        for (uint i = 0; i < 32; i++) {
            bytes1 b = bytes1(uint8(uint(value) / (2**(8*(31 - i)))));
            bytes1 hi = bytes1(uint8(b) / 16);
            bytes1 lo = bytes1(uint8(b) - 16 * uint8(hi));
            s[2*i] = char(hi);
            s[2*i+1] = char(lo);            
        }
        return string(abi.encodePacked("0x", string(s)));
    }

    function uint8ToString(uint8 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint8 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint8(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function char(bytes1 b) internal pure returns (bytes1) {
        if (uint8(b) < 10) return bytes1(uint8(b) + 0x30);
        else return bytes1(uint8(b) + 0x57);
    }
}