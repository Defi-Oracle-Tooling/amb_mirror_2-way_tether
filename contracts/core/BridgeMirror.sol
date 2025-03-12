// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/IBridgeMirror.sol";
import "../interfaces/IBridgeGovernance.sol";
import "../core/BridgeErrors.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract BridgeMirror is IBridgeMirror, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;

    IBridgeGovernance public immutable governance;
    mapping(string => bool) public features;
    mapping(bytes32 => bool) public processedTransactions;
    mapping(uint256 => bool) public supportedChains;

    event TransactionProcessed(bytes32 indexed txHash, bool success);
    event ConfigurationUpdated(string indexed parameter, bytes value);
    event ChainStatusUpdated(uint256 indexed chainId, bool supported);

    modifier onlyOperator() {
        if (!governance.hasRole(msg.sender, IBridgeGovernance.Role.OPERATOR)) {
            revert BridgeErrors.UnauthorizedRole(msg.sender, uint8(IBridgeGovernance.Role.OPERATOR));
        }
        _;
    }

    modifier onlyAdmin() {
        if (!governance.hasRole(msg.sender, IBridgeGovernance.Role.ADMIN)) {
            revert BridgeErrors.UnauthorizedRole(msg.sender, uint8(IBridgeGovernance.Role.ADMIN));
        }
        _;
    }

    modifier onlyGuardian() {
        if (!governance.hasRole(msg.sender, IBridgeGovernance.Role.GUARDIAN)) {
            revert BridgeErrors.UnauthorizedRole(msg.sender, uint8(IBridgeGovernance.Role.GUARDIAN));
        }
        _;
    }

    modifier featureEnabled(string memory feature) {
        if (!features[feature]) {
            revert BridgeErrors.FeatureNotEnabled(feature);
        }
        _;
    }

    modifier validChain(uint256 chainId) {
        if (!supportedChains[chainId]) {
            revert BridgeErrors.UnsupportedChain(chainId);
        }
        if (chainId == block.chainid) {
            revert BridgeErrors.InvalidSourceChain(chainId);
        }
        _;
    }

    constructor(address governanceAddress) {
        if (governanceAddress == address(0)) {
            revert BridgeErrors.InvalidGovernanceAddress(governanceAddress);
        }
        governance = IBridgeGovernance(governanceAddress);
    }

    function mirrorTransaction(
        uint256 sourceChainId,
        address sourceAddress,
        bytes32 transactionHash,
        bytes calldata data
    ) 
        external 
        override 
        onlyOperator 
        featureEnabled("CROSS_CHAIN_MIRROR")
        validChain(sourceChainId)
        nonReentrant
        whenNotPaused 
    {
        if (processedTransactions[transactionHash]) {
            revert BridgeErrors.TransactionAlreadyProcessed(transactionHash);
        }
        if (sourceAddress == address(0)) {
            revert BridgeErrors.InvalidTransactionData(transactionHash, "Invalid source address");
        }
        if (data.length < 4) {
            revert BridgeErrors.InvalidTransactionData(transactionHash, "Invalid data length");
        }
        
        processedTransactions[transactionHash] = true;

        emit TransactionMirrored(
            sourceChainId,
            sourceAddress,
            transactionHash,
            data
        );

        emit TransactionProcessed(transactionHash, true);
    }

    function toggleFeature(string calldata feature, bool enabled) 
        external 
        override 
        onlyAdmin 
        whenNotPaused
    {
        features[feature] = enabled;
        emit FeatureFlagUpdated(feature, enabled);
    }

    function updateSupportedChain(uint256 chainId, bool supported)
        external
        onlyAdmin
        whenNotPaused
    {
        if (chainId == block.chainid) {
            revert BridgeErrors.InvalidTargetChain(chainId);
        }
        supportedChains[chainId] = supported;
        emit ChainStatusUpdated(chainId, supported);
    }

    function isFeatureEnabled(string calldata feature) 
        external 
        view 
        override 
        returns (bool) 
    {
        return features[feature];
    }

    // Additional helper functions
    function isTransactionProcessed(bytes32 txHash) external view returns (bool) {
        return processedTransactions[txHash];
    }

    function getGovernanceAddress() external view returns (address) {
        return address(governance);
    }

    function isChainSupported(uint256 chainId) external view returns (bool) {
        return supportedChains[chainId];
    }

    // Emergency controls
    function pause() external onlyGuardian {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }
}