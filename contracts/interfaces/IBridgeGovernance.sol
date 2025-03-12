// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IBridgeGovernance {
    enum Role {
        NONE,
        OPERATOR,
        ADMIN,
        GUARDIAN
    }

    event RoleAssigned(address indexed account, Role role);
    event RoleRevoked(address indexed account, Role role);
    event SignerAdded(address indexed signer);
    event SignerRemoved(address indexed signer);
    event ThresholdUpdated(uint256 newThreshold);
    event TransactionProposed(bytes32 indexed txHash, address indexed proposer);
    event TransactionExecuted(bytes32 indexed txHash);
    event TransactionCancelled(bytes32 indexed txHash);

    /**
     * @dev Assign a role to an account
     */
    function assignRole(address account, Role role) external;

    /**
     * @dev Revoke a role from an account
     */
    function revokeRole(address account) external;

    /**
     * @dev Add a signer to the multi-sig
     */
    function addSigner(address signer) external;

    /**
     * @dev Remove a signer from the multi-sig
     */
    function removeSigner(address signer) external;

    /**
     * @dev Update the number of required signatures
     */
    function updateThreshold(uint256 newThreshold) external;

    /**
     * @dev Propose a transaction for multi-sig execution
     */
    function proposeTransaction(
        address target,
        uint256 value,
        bytes calldata data
    ) external returns (bytes32);

    /**
     * @dev Sign a proposed transaction
     */
    function signTransaction(bytes32 txHash) external;

    /**
     * @dev Execute a transaction that has met the signature threshold
     */
    function executeTransaction(bytes32 txHash) external;

    /**
     * @dev Cancel a proposed transaction
     */
    function cancelTransaction(bytes32 txHash) external;

    /**
     * @dev Check if an account has a specific role
     */
    function hasRole(address account, Role role) external view returns (bool);

    /**
     * @dev Get the current signature threshold
     */
    function getThreshold() external view returns (uint256);

    /**
     * @dev Get the number of signatures for a transaction
     */
    function getSignatureCount(bytes32 txHash) external view returns (uint256);
}