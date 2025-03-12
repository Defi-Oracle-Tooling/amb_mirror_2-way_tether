// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IBridgeMirror {
    /**
     * @dev Emitted when a transaction is mirrored from the source chain
     */
    event TransactionMirrored(
        uint256 indexed sourceChainId,
        address indexed sourceAddress,
        bytes32 indexed transactionHash,
        bytes data
    );

    /**
     * @dev Emitted when feature flags are updated
     */
    event FeatureFlagUpdated(string feature, bool enabled);

    /**
     * @dev Mirror a transaction from the source chain
     * @param sourceChainId The chain ID of the source chain
     * @param sourceAddress The address that initiated the transaction on the source chain
     * @param transactionHash The hash of the transaction on the source chain
     * @param data The transaction data to be mirrored
     */
    function mirrorTransaction(
        uint256 sourceChainId,
        address sourceAddress,
        bytes32 transactionHash,
        bytes calldata data
    ) external;

    /**
     * @dev Toggle a feature flag
     * @param feature The name of the feature to toggle
     * @param enabled The new state of the feature
     */
    function toggleFeature(string calldata feature, bool enabled) external;

    /**
     * @dev Check if a feature is enabled
     * @param feature The name of the feature to check
     */
    function isFeatureEnabled(string calldata feature) external view returns (bool);
}