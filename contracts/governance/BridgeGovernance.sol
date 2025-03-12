// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/IBridgeGovernance.sol";
import "../core/BridgeErrors.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract BridgeGovernance is IBridgeGovernance, ReentrancyGuard, Pausable {
    struct Transaction {
        address target;
        uint256 value;
        bytes data;
        bool executed;
        uint256 sigCount;
        mapping(address => bool) signatures;
    }

    // State variables
    mapping(bytes32 => Transaction) public transactions;
    mapping(address => Role) public roles;
    mapping(address => bool) public isAuthorizedSigner;
    uint256 public threshold;
    address[] public signers;

    // Modifiers
    modifier onlyRole(Role requiredRole) {
        if (roles[msg.sender] < requiredRole) {
            revert BridgeErrors.UnauthorizedRole(msg.sender, uint8(requiredRole));
        }
        _;
    }

    modifier onlySigner() {
        if (!isAuthorizedSigner[msg.sender]) {
            revert BridgeErrors.InvalidSignerUpdate(msg.sender, "Not authorized signer");
        }
        _;
    }

    modifier txExists(bytes32 txHash) {
        if (transactions[txHash].target == address(0)) {
            revert BridgeErrors.TransactionDoesNotExist(txHash);
        }
        _;
    }

    modifier notExecuted(bytes32 txHash) {
        if (transactions[txHash].executed) {
            revert BridgeErrors.TransactionAlreadyExecuted(txHash);
        }
        _;
    }

    constructor() {
        roles[msg.sender] = Role.ADMIN;
        threshold = 1;
        isAuthorizedSigner[msg.sender] = true;
        signers.push(msg.sender);
    }

    function assignRole(address account, Role role) external override onlyRole(Role.ADMIN) {
        if (account == address(0)) {
            revert BridgeErrors.InvalidRoleAssignment(account, uint8(role));
        }
        if (role == Role.NONE) {
            revert BridgeErrors.InvalidRoleAssignment(account, uint8(role));
        }
        
        roles[account] = role;
        if (role >= Role.ADMIN) {
            if (!isAuthorizedSigner[account]) {
                isAuthorizedSigner[account] = true;
                signers.push(account);
            }
        }
        emit RoleAssigned(account, role);
    }

    function revokeRole(address account) external override onlyRole(Role.ADMIN) {
        if (account == msg.sender) {
            revert BridgeErrors.CannotRevokeOwnRole(account);
        }
        if (roles[account] == Role.NONE) {
            revert BridgeErrors.InvalidRoleAssignment(account, uint8(Role.NONE));
        }
        
        if (isAuthorizedSigner[account]) {
            if (signers.length <= threshold) {
                revert BridgeErrors.InvalidThresholdUpdate(
                    threshold,
                    threshold,
                    signers.length - 1
                );
            }
            isAuthorizedSigner[account] = false;
            for (uint i = 0; i < signers.length; i++) {
                if (signers[i] == account) {
                    signers[i] = signers[signers.length - 1];
                    signers.pop();
                    break;
                }
            }
        }
        
        roles[account] = Role.NONE;
        emit RoleRevoked(account, Role.NONE);
    }

    function addSigner(address signer) external override onlyRole(Role.ADMIN) {
        if (isAuthorizedSigner[signer]) {
            revert BridgeErrors.InvalidSignerUpdate(signer, "Already a signer");
        }
        isAuthorizedSigner[signer] = true;
        signers.push(signer);
        emit SignerAdded(signer);
    }

    function removeSigner(address signer) external override onlyRole(Role.ADMIN) {
        if (!isAuthorizedSigner[signer]) {
            revert BridgeErrors.InvalidSignerUpdate(signer, "Not a signer");
        }
        if (signers.length <= threshold) {
            revert BridgeErrors.InvalidThresholdUpdate(
                threshold,
                threshold,
                signers.length - 1
            );
        }
        if (signer == msg.sender) {
            revert BridgeErrors.InvalidSignerUpdate(signer, "Cannot remove self");
        }
        
        isAuthorizedSigner[signer] = false;
        for (uint i = 0; i < signers.length; i++) {
            if (signers[i] == signer) {
                signers[i] = signers[signers.length - 1];
                signers.pop();
                break;
            }
        }
        emit SignerRemoved(signer);
    }

    function updateThreshold(uint256 newThreshold) external override onlyRole(Role.ADMIN) {
        if (newThreshold == 0 || newThreshold > signers.length) {
            revert BridgeErrors.InvalidThresholdUpdate(
                threshold,
                newThreshold,
                signers.length
            );
        }
        threshold = newThreshold;
        emit ThresholdUpdated(newThreshold);
    }

    function proposeTransaction(
        address target,
        uint256 value,
        bytes calldata data
    ) external override onlySigner whenNotPaused returns (bytes32) {
        if (target == address(0)) {
            revert BridgeErrors.InvalidTransactionData(bytes32(0), "Invalid target");
        }
        
        bytes32 txHash = keccak256(abi.encodePacked(target, value, data, block.number));
        if (transactions[txHash].target != address(0)) {
            revert BridgeErrors.TransactionAlreadyProcessed(txHash);
        }

        Transaction storage transaction = transactions[txHash];
        transaction.target = target;
        transaction.value = value;
        transaction.data = data;
        transaction.sigCount = 0;
        
        emit TransactionProposed(txHash, msg.sender);
        return txHash;
    }

    function signTransaction(bytes32 txHash) 
        external 
        override 
        onlySigner 
        txExists(txHash) 
        notExecuted(txHash)
        whenNotPaused
        nonReentrant
    {
        Transaction storage transaction = transactions[txHash];
        if (transaction.signatures[msg.sender]) {
            revert BridgeErrors.InvalidTransactionData(txHash, "Already signed");
        }
        
        transaction.signatures[msg.sender] = true;
        transaction.sigCount++;
    }

    function executeTransaction(bytes32 txHash) 
        external 
        override 
        txExists(txHash) 
        notExecuted(txHash)
        whenNotPaused
        nonReentrant
    {
        Transaction storage transaction = transactions[txHash];
        if (transaction.sigCount < threshold) {
            revert BridgeErrors.InsufficientSignatures(
                txHash,
                transaction.sigCount,
                threshold
            );
        }

        transaction.executed = true;
        (bool success, bytes memory result) = transaction.target.call{value: transaction.value}(transaction.data);
        if (!success) {
            revert BridgeErrors.TransactionExecutionFailed(txHash, result);
        }

        emit TransactionExecuted(txHash);
    }

    function cancelTransaction(bytes32 txHash) 
        external 
        override 
        txExists(txHash) 
        notExecuted(txHash) 
        onlyRole(Role.ADMIN) 
    {
        delete transactions[txHash];
        emit TransactionCancelled(txHash);
    }

    function hasRole(address account, Role role) external view override returns (bool) {
        return roles[account] >= role;
    }

    function getThreshold() external view override returns (uint256) {
        return threshold;
    }

    function getSignatureCount(bytes32 txHash) external view override returns (uint256) {
        return transactions[txHash].sigCount;
    }

    // Additional helper functions
    function getSigners() external view returns (address[] memory) {
        return signers;
    }

    function hasSignedTransaction(bytes32 txHash, address signer) external view returns (bool) {
        return transactions[txHash].signatures[signer];
    }

    // Emergency controls
    function pause() external onlyRole(Role.GUARDIAN) {
        _pause();
    }

    function unpause() external onlyRole(Role.ADMIN) {
        _unpause();
    }
}