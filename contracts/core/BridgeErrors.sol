// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library BridgeErrors {
    // Access Control Errors
    error UnauthorizedAccess(address caller, string required_role);
    error InvalidAdmin(address caller);
    error InvalidOperator(address caller);
    error InvalidGuardian(address caller);

    // Asset Related Errors
    error UnsupportedAsset(address asset);
    error InsufficientBalance(address asset, uint256 requested, uint256 available);
    error InvalidAmount(uint256 amount);
    error TransferFailed(address asset, address from, address to, uint256 amount);
    error MintFailed(address asset, address to, uint256 amount);
    error BurnFailed(address asset, address from, uint256 amount);

    // Bridge Operation Errors
    error InvalidProof(bytes proof);
    error ProofAlreadyUsed(bytes32 proofHash);
    error BridgeOperationFailed(string reason);
    error InvalidDestinationChain(uint256 chainId);
    error ExcessiveAmount(uint256 amount, uint256 limit);
    error InvalidNonce(uint256 provided, uint256 expected);

    // Governance Errors
    error ProposalNotFound(bytes32 proposalId);
    error ProposalAlreadyExecuted(bytes32 proposalId);
    error ProposalNotReady(bytes32 proposalId, uint256 currentTime, uint256 executionTime);
    error InvalidProposalParameters();
    error TimelockNotExpired(uint256 remaining);

    // System State Errors
    error SystemPaused();
    error BridgeLocked();
    error InvalidState(string expected, string actual);

    // Configuration Errors
    error InvalidConfiguration(string parameter);
    error InvalidThreshold(uint256 provided, uint256 min, uint256 max);
    error InvalidAddress(address providedAddress);
    error ZeroAddress();

    // ERC Standards Errors
    error ERC20TransferFailed(address token, address from, address to, uint256 amount);
    error ERC721TransferFailed(address token, address from, address to, uint256 tokenId);
    error ERC1155TransferFailed(address token, address from, address to, uint256 id, uint256 amount);
    error ERC777TransferFailed(address token, address from, address to, uint256 amount);
    error ERC4626DepositFailed(address vault, address asset, uint256 amount);

    // Event Emission for Monitoring
    event ErrorLogged(
        string indexed errorType,
        string message,
        address indexed actor,
        uint256 timestamp
    );
    
    // Logging function for monitoring
    function logError(
        string memory errorType,
        string memory message,
        address actor
    ) internal {
        emit ErrorLogged(
            errorType,
            message,
            actor,
            block.timestamp
        );
    }
}