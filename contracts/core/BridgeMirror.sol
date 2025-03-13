// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IBridgeMirror.sol";
import "../interfaces/IBridgeGovernance.sol";
import "../core/BridgeErrors.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title BridgeMirror
 * @dev Core contract for the cross-chain bridge with enhanced communication capabilities
 * Supports cross-chain asset transfers, message passing, and yield strategies
 */
contract BridgeMirror is IBridgeMirror, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // Core state variables
    IBridgeGovernance public immutable governance;
    mapping(string => bool) public features;
    mapping(bytes32 => bool) public processedTransactions;
    mapping(uint256 => bool) public supportedChains;

    // Enhanced cross-chain communication
    mapping(bytes32 => MessageStatus) public messages;
    mapping(uint256 => address) public chainValidators;
    mapping(uint256 => MessageRelayer) public chainRelayers;
    mapping(bytes32 => MessageProof) public messageProofs;
    
    // Cross-chain asset registry
    mapping(uint256 => mapping(address => CrossChainAsset)) public crossChainAssets;
    mapping(bytes32 => TransactionReceipt) public transactionReceipts;

    // Yield strategy settings
    mapping(uint256 => mapping(address => YieldConfig)) public yieldStrategies;
    mapping(address => mapping(uint256 => uint256)) public strategicAllocations;
    
    // Fee configuration
    uint256 public baseFee;
    uint256 public feePercentage; // in basis points (1/100 of a percent)
    address public feeRecipient;
    
    // Circuit breaker settings
    uint256 public transferLimit;
    uint256 public dailyLimit;
    uint256 public dailyVolume;
    uint256 public lastDayReset;
    
    // Events
    event TransactionProcessed(bytes32 indexed txHash, bool success);
    event ConfigurationUpdated(string indexed parameter, bytes value);
    event ChainStatusUpdated(uint256 indexed chainId, bool supported);
    event MessageSent(bytes32 indexed messageId, uint256 targetChain, address recipient, bytes data);
    event MessageReceived(bytes32 indexed messageId, uint256 sourceChain, address sender, bytes data);
    event AssetRegistered(uint256 sourceChain, address sourceAsset, uint256 targetChain, address targetAsset, string assetType);
    event YieldStrategyConfigured(uint256 chainId, address asset, address strategy, uint256 allocation);
    event FeeCollected(bytes32 indexed txHash, address payer, uint256 amount);
    event CircuitBreakerTriggered(string reason, uint256 timestamp);

    struct MessageStatus {
        uint256 sourceChain;
        address sender;
        uint256 targetChain;
        address recipient;
        bytes data;
        MessageState state;
        uint256 timestamp;
    }
    
    struct MessageRelayer {
        address relayer;
        uint256 requiredConfirmations;
        uint256 timeout; // in seconds
    }
    
    struct MessageProof {
        bytes32 messageId;
        bytes signature;
        address validator;
        uint256 timestamp;
    }
    
    struct TransactionReceipt {
        bytes32 messageId;
        bool success;
        bytes result;
        uint256 gasUsed;
        uint256 timestamp;
    }
    
    struct CrossChainAsset {
        address targetAsset;
        string assetType; // "ERC20", "ERC721", "ERC1155", "ERC4626", etc.
        bool registered;
        bool frozen;
        uint256 decimals;
        uint256 cap; // maximum amount that can be bridged
        uint256 totalBridged;
    }
    
    struct YieldConfig {
        address strategyContract;
        uint256 allocationPercentage; // in basis points (1/100 of a percent)
        uint256 targetAPR; // target annual percentage rate in basis points
        bool active;
        uint256 lastHarvest;
        uint256 harvestFrequency; // minimum time between harvests in seconds
    }
    
    enum MessageState { Pending, Confirmed, Executed, Failed, Expired }
    
    // Modifiers
    modifier onlyOperator() {
        if (!governance.hasRole(msg.sender, IBridgeGovernance.Role.OPERATOR)) {
            revert BridgeErrors.UnauthorizedRole(msg.sender, uint8(IBridgeGovernance.Role.OPERATOR));
        }
        _;
    }
    
    modifier onlyAdmin() {
        if (msg.sender != address(governance) && !governance.hasRole(msg.sender, IBridgeGovernance.Role.ADMIN)) {
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
    
    modifier onlyRelayer(uint256 chainId) {
        if (msg.sender != chainRelayers[chainId].relayer) {
            revert BridgeErrors.UnauthorizedRelayer(msg.sender, chainId);
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
    
    modifier withinLimits(uint256 amount) {
        if (amount > transferLimit) {
            revert BridgeErrors.TransferLimitExceeded(amount, transferLimit);
        }
        
        // Reset daily volume if it's a new day
        if (block.timestamp >= lastDayReset + 1 days) {
            dailyVolume = 0;
            lastDayReset = block.timestamp;
        }
        
        if (dailyVolume + amount > dailyLimit) {
            revert BridgeErrors.DailyLimitExceeded(dailyVolume + amount, dailyLimit);
        }
        
        _;
        
        // Update daily volume after the transaction
        dailyVolume += amount;
    }
    
    constructor(address governanceAddress) {
        if (governanceAddress == address(0)) {
            revert BridgeErrors.InvalidGovernanceAddress(governanceAddress);
        }
        governance = IBridgeGovernance(governanceAddress);
        lastDayReset = block.timestamp;
    }

    /**
     * @dev Enhanced mirror transaction function with better validation and error handling
     * @param sourceChainId The chain ID where the transaction originated
     * @param sourceAddress The address that sent the transaction on the source chain
     * @param transactionHash The hash of the transaction on the source chain
     * @param data The calldata to execute on this chain
     * @param proof Additional proof data to validate the transaction
     */
    function mirrorTransaction(
        uint256 sourceChainId,
        address sourceAddress,
        bytes32 transactionHash,
        bytes calldata data,
        bytes calldata proof
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
        
        // Validate the transaction proof if a validator is configured
        if (chainValidators[sourceChainId] != address(0)) {
            _validateTransactionProof(sourceChainId, transactionHash, proof);
        }
        
        // Mark as processed before execution to prevent reentrancy
        processedTransactions[transactionHash] = true;
        
        // Execute the transaction
        (bool success, bytes memory result) = address(this).call(data);
        
        // Store the receipt
        transactionReceipts[transactionHash] = TransactionReceipt({
            messageId: transactionHash,
            success: success,
            result: result,
            gasUsed: gasleft(),
            timestamp: block.timestamp
        });
        
        emit TransactionMirrored(
            sourceChainId,
            sourceAddress,
            transactionHash,
            data
        );
        
        emit TransactionProcessed(transactionHash, success);
    }

    /**
     * @dev Sends a message to another chain
     * @param targetChain The target chain ID
     * @param recipient The recipient address on the target chain
     * @param data The data to send
     * @return messageId The unique ID of the message
     */
    function sendMessage(
        uint256 targetChain,
        address recipient,
        bytes calldata data
    )
        external
        featureEnabled("CROSS_CHAIN_MESSAGING")
        validChain(targetChain)
        nonReentrant
        whenNotPaused
        returns (bytes32 messageId)
    {
        if (recipient == address(0)) {
            revert BridgeErrors.InvalidRecipient(recipient);
        }
        
        // Calculate message fee
        uint256 fee = _calculateMessageFee(targetChain, data.length);
        
        // Collect fee
        if (fee > 0) {
            _collectFee(msg.sender, fee);
        }
        
        // Generate unique message ID
        messageId = keccak256(abi.encodePacked(
            block.chainid,
            msg.sender,
            targetChain,
            recipient,
            data,
            block.timestamp
        ));
        
        // Store message
        messages[messageId] = MessageStatus({
            sourceChain: block.chainid,
            sender: msg.sender,
            targetChain: targetChain,
            recipient: recipient,
            data: data,
            state: MessageState.Pending,
            timestamp: block.timestamp
        });
        
        emit MessageSent(messageId, targetChain, recipient, data);
        
        return messageId;
    }
    
    /**
     * @dev Receives a message from another chain
     * @param sourceChain The source chain ID
     * @param sender The sender address on the source chain
     * @param messageId The unique ID of the message
     * @param data The data sent
     * @param proof The proof of the message
     */
    function receiveMessage(
        uint256 sourceChain,
        address sender,
        bytes32 messageId,
        bytes calldata data,
        bytes calldata proof
    )
        external
        onlyRelayer(sourceChain)
        featureEnabled("CROSS_CHAIN_MESSAGING")
        validChain(sourceChain)
        nonReentrant
        whenNotPaused
    {
        if (messages[messageId].state != MessageState.Pending && 
            messages[messageId].state != MessageState.Confirmed) {
            revert BridgeErrors.InvalidMessageState(messageId, uint8(messages[messageId].state));
        }
        
        // Validate message proof
        _validateMessageProof(sourceChain, messageId, proof);
        
        // Update message state
        messages[messageId] = MessageStatus({
            sourceChain: sourceChain,
            sender: sender,
            targetChain: block.chainid,
            recipient: address(0), // Will be set during execution
            data: data,
            state: MessageState.Confirmed,
            timestamp: block.timestamp
        });
        
        emit MessageReceived(messageId, sourceChain, sender, data);
    }
    
    /**
     * @dev Executes a confirmed message
     * @param messageId The unique ID of the message
     * @param recipient The recipient address
     */
    function executeMessage(bytes32 messageId, address recipient)
        external
        featureEnabled("CROSS_CHAIN_MESSAGING")
        nonReentrant
        whenNotPaused
    {
        MessageStatus storage message = messages[messageId];
        
        if (message.state != MessageState.Confirmed) {
            revert BridgeErrors.InvalidMessageState(messageId, uint8(message.state));
        }
        
        if (recipient == address(0)) {
            revert BridgeErrors.InvalidRecipient(recipient);
        }
        
        // Update message recipient and state
        message.recipient = recipient;
        message.state = MessageState.Executed;
        
        // Execute the message
        (bool success, bytes memory result) = recipient.call(message.data);
        
        if (!success) {
            message.state = MessageState.Failed;
            
            // Store the failure information
            if (result.length > 0) {
                // Extract revert reason if available
                assembly {
                    let resultLength := mload(result)
                    revert(add(32, result), resultLength)
                }
            } else {
                revert BridgeErrors.MessageExecutionFailed(messageId);
            }
        }
    }
    
    /**
     * @dev Registers a cross-chain asset mapping
     * @param sourceChainId The source chain ID
     * @param sourceAsset The asset address on the source chain
     * @param targetChainId The target chain ID
     * @param targetAsset The corresponding asset address on the target chain
     * @param assetType The type of asset (ERC20, ERC721, etc.)
     * @param decimals The number of decimals the asset has
     * @param cap The maximum amount that can be bridged
     */
    function registerCrossChainAsset(
        uint256 sourceChainId,
        address sourceAsset,
        uint256 targetChainId,
        address targetAsset,
        string calldata assetType,
        uint8 decimals,
        uint256 cap
    )
        external
        onlyAdmin
        featureEnabled("ASSET_REGISTRY")
        whenNotPaused
    {
        if (sourceAsset == address(0) || targetAsset == address(0)) {
            revert BridgeErrors.InvalidAddress(address(0));
        }
        
        if (!supportedChains[sourceChainId] || !supportedChains[targetChainId]) {
            revert BridgeErrors.UnsupportedChain(sourceChainId);
        }
        
        crossChainAssets[sourceChainId][sourceAsset] = CrossChainAsset({
            targetAsset: targetAsset,
            assetType: assetType,
            registered: true,
            frozen: false,
            decimals: decimals,
            cap: cap,
            totalBridged: 0
        });
        
        emit AssetRegistered(sourceChainId, sourceAsset, targetChainId, targetAsset, assetType);
    }
    
    /**
     * @dev Configures a yield strategy for a specific asset and chain
     * @param chainId The chain ID where the asset exists
     * @param asset The asset address
     * @param strategyContract The yield strategy contract address
     * @param allocationPercentage The percentage of assets to allocate to this strategy
     * @param targetAPR The target APR for the strategy
     * @param harvestFrequency The minimum time between harvests
     */
    function configureYieldStrategy(
        uint256 chainId,
        address asset,
        address strategyContract,
        uint256 allocationPercentage,
        uint256 targetAPR,
        uint256 harvestFrequency
    )
        external
        onlyAdmin
        featureEnabled("YIELD_STRATEGIES")
        whenNotPaused
    {
        if (asset == address(0) || strategyContract == address(0)) {
            revert BridgeErrors.InvalidAddress(address(0));
        }
        
        if (allocationPercentage > 10000) { // 100% in basis points
            revert BridgeErrors.InvalidAllocation(allocationPercentage);
        }
        
        yieldStrategies[chainId][asset] = YieldConfig({
            strategyContract: strategyContract,
            allocationPercentage: allocationPercentage,
            targetAPR: targetAPR,
            active: true,
            lastHarvest: block.timestamp,
            harvestFrequency: harvestFrequency
        });
        
        strategicAllocations[asset][chainId] = allocationPercentage;
        
        emit YieldStrategyConfigured(chainId, asset, strategyContract, allocationPercentage);
    }
    
    /**
     * @dev Sets the fee configuration
     * @param _baseFee The base fee for transactions
     * @param _feePercentage The percentage fee in basis points
     * @param _recipient The fee recipient address
     */
    function setFeeConfiguration(
        uint256 _baseFee, 
        uint256 _feePercentage, 
        address _recipient
    )
        external
        onlyAdmin
        whenNotPaused
    {
        if (_feePercentage > 1000) { // Max 10%
            revert BridgeErrors.FeeTooHigh();
        }
        
        if (_recipient == address(0)) {
            revert BridgeErrors.InvalidAddress(_recipient);
        }
        
        baseFee = _baseFee;
        feePercentage = _feePercentage;
        feeRecipient = _recipient;
        
        emit ConfigurationUpdated("FeeConfig", abi.encode(_baseFee, _feePercentage, _recipient));
    }
    
    /**
     * @dev Sets the circuit breaker limits
     * @param _transferLimit The maximum amount per transaction
     * @param _dailyLimit The maximum total amount per day
     */
    function setLimits(uint256 _transferLimit, uint256 _dailyLimit)
        external
        onlyAdmin
        whenNotPaused
    {
        transferLimit = _transferLimit;
        dailyLimit = _dailyLimit;
        
        emit ConfigurationUpdated("Limits", abi.encode(_transferLimit, _dailyLimit));
    }

    /**
     * @dev Sets a validator for a specific chain
     * @param chainId The chain ID
     * @param validator The validator address
     */
    function setChainValidator(uint256 chainId, address validator)
        external
        onlyAdmin
        whenNotPaused
    {
        if (chainId == block.chainid) {
            revert BridgeErrors.InvalidTargetChain(chainId);
        }
        
        chainValidators[chainId] = validator;
        
        emit ConfigurationUpdated("Validator", abi.encode(chainId, validator));
    }
    
    /**
     * @dev Sets a relayer for a specific chain
     * @param chainId The chain ID
     * @param relayer The relayer address
     * @param requiredConfirmations The number of confirmations required
     * @param timeout The timeout period in seconds
     */
    function setChainRelayer(
        uint256 chainId, 
        address relayer, 
        uint256 requiredConfirmations,
        uint256 timeout
    )
        external
        onlyAdmin
        whenNotPaused
    {
        if (chainId == block.chainid) {
            revert BridgeErrors.InvalidTargetChain(chainId);
        }
        
        chainRelayers[chainId] = MessageRelayer({
            relayer: relayer,
            requiredConfirmations: requiredConfirmations,
            timeout: timeout
        });
        
        emit ConfigurationUpdated("Relayer", abi.encode(chainId, relayer, requiredConfirmations, timeout));
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

    /**
     * @dev Triggers circuit breaker to pause all operations
     * @param reason The reason for triggering the circuit breaker
     */
    function triggerCircuitBreaker(string calldata reason) external onlyGuardian {
        _pause();
        emit CircuitBreakerTriggered(reason, block.timestamp);
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
    
    function getMessageStatus(bytes32 messageId) external view returns (MessageStatus memory) {
        return messages[messageId];
    }
    
    function getTransactionReceipt(bytes32 txHash) external view returns (TransactionReceipt memory) {
        return transactionReceipts[txHash];
    }
    
    function getCrossChainAsset(uint256 chainId, address asset) external view returns (CrossChainAsset memory) {
        return crossChainAssets[chainId][asset];
    }
    
    function getYieldStrategy(uint256 chainId, address asset) external view returns (YieldConfig memory) {
        return yieldStrategies[chainId][asset];
    }
    
    function getStrategicAllocation(address asset, uint256 chainId) external view returns (uint256) {
        return strategicAllocations[asset][chainId];
    }
    
    // Emergency controls
    function pause() external onlyGuardian {
        _pause();
    }
    
    function unpause() external onlyAdmin {
        _unpause();
    }
    
    // Internal functions
    
    /**
     * @dev Validates a transaction proof
     * @param sourceChainId The source chain ID
     * @param transactionHash The transaction hash
     * @param proof The proof data
     */
    function _validateTransactionProof(
        uint256 sourceChainId,
        bytes32 transactionHash,
        bytes calldata proof
    ) internal view {
        if (proof.length == 0) {
            revert BridgeErrors.InvalidProof(transactionHash);
        }
        
        address validator = chainValidators[sourceChainId];
        
        bytes32 message = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            transactionHash
        ));
        
        address signer = message.recover(proof);
        
        if (signer != validator) {
            revert BridgeErrors.InvalidProofSignature(transactionHash, signer, validator);
        }
    }
    
    /**
     * @dev Validates a message proof
     * @param sourceChainId The source chain ID
     * @param messageId The message ID
     * @param proof The proof data
     */
    function _validateMessageProof(
        uint256 sourceChainId,
        bytes32 messageId,
        bytes calldata proof
    ) internal {
        if (proof.length == 0) {
            revert BridgeErrors.InvalidProof(messageId);
        }
        
        address validator = chainValidators[sourceChainId];
        
        bytes32 message = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            messageId
        ));
        
        address signer = message.recover(proof);
        
        if (signer != validator) {
            revert BridgeErrors.InvalidProofSignature(messageId, signer, validator);
        }
        
        // Store the proof for verification
        messageProofs[messageId] = MessageProof({
            messageId: messageId,
            signature: proof,
            validator: validator,
            timestamp: block.timestamp
        });
    }
    
    /**
     * @dev Calculates the fee for sending a message
     * @param targetChain The target chain ID
     * @param dataSize The size of the message data
     * @return fee The calculated fee
     */
    function _calculateMessageFee(uint256 targetChain, uint256 dataSize) internal view returns (uint256) {
        // Base fee + percentage based on data size
        return baseFee + ((dataSize * feePercentage) / 10000);
    }
    
    /**
     * @dev Collects a fee from the sender
     * @param from The address to collect the fee from
     * @param amount The fee amount
     */
    function _collectFee(address from, uint256 amount) internal {
        if (amount == 0 || feeRecipient == address(0)) {
            return;
        }
        
        // Transfer fee from sender to fee recipient
        // In a real implementation, you would use a token transfer here
        // For now, we'll just emit an event to simulate fee collection
        emit FeeCollected(keccak256(abi.encodePacked(block.timestamp, from)), from, amount);
    }
}