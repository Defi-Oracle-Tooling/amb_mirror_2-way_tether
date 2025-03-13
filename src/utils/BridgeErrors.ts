export enum BridgeErrorType {
    // Governance Errors
    Unauthorized = "Unauthorized",
    InsufficientSignatures = "InsufficientSignatures",
    InvalidRole = "InvalidRole",
    TimelockNotExpired = "TimelockNotExpired",
    AlreadySigned = "AlreadySigned",
    AlreadyExecuted = "AlreadyExecuted",

    // Feature Management Errors
    FeatureNotEnabled = "FeatureNotEnabled",
    FeatureAlreadyEnabled = "FeatureAlreadyEnabled",
    InvalidFeature = "InvalidFeature",

    // Token/NFT Management Errors
    TokenNotRegistered = "TokenNotRegistered",
    CollectionNotRegistered = "CollectionNotRegistered",
    InvalidTokenAddress = "InvalidTokenAddress",
    InvalidCollectionAddress = "InvalidCollectionAddress",
    InsufficientBalance = "InsufficientBalance",
    TransferFailed = "TransferFailed",

    // Cross-Chain Operation Errors
    InvalidChainId = "InvalidChainId",
    InvalidDestination = "InvalidDestination",
    InvalidSourceChain = "InvalidSourceChain",
    TransactionAlreadyProcessed = "TransactionAlreadyProcessed",
    InvalidLockId = "InvalidLockId",
    LockAlreadyProcessed = "LockAlreadyProcessed",
    CrossChainRequestFailed = "CrossChainRequestFailed",

    // Vault Errors
    VaultNotRegistered = "VaultNotRegistered",
    InvalidVaultAddress = "InvalidVaultAddress",
    ShareCalculationFailed = "ShareCalculationFailed",
    InsufficientShares = "InsufficientShares",
    WithdrawalFailed = "WithdrawalFailed",

    // Bridge Operation Errors
    BridgePaused = "BridgePaused",
    InvalidAmount = "InvalidAmount",
    InvalidData = "InvalidData",
    OperationNotSupported = "OperationNotSupported",
    MaxTokensExceeded = "MaxTokensExceeded",
    MaxTransferAmountExceeded = "MaxTransferAmountExceeded",

    // System/Technical Errors
    ZeroAddress = "ZeroAddress",
    InvalidSignature = "InvalidSignature",
    DeadlineExpired = "DeadlineExpired",
    InvalidNonce = "InvalidNonce",
    ContractCallFailed = "ContractCallFailed",
    InvalidArrayLength = "InvalidArrayLength",
    UpgradeFailed = "UpgradeFailed"
}

export interface BridgeErrorData {
    type: BridgeErrorType;
    message: string;
    details?: Record<string, any>;
    chainId?: number;
    txHash?: string;
}

export class BridgeError extends Error {
    public readonly type: BridgeErrorType;
    public readonly details?: Record<string, any>;
    public readonly chainId?: number;
    public readonly txHash?: string;

    constructor(data: BridgeErrorData) {
        super(data.message);
        this.name = 'BridgeError';
        this.type = data.type;
        this.details = data.details;
        this.chainId = data.chainId;
        this.txHash = data.txHash;

        // Maintains proper stack trace for where our error was thrown (only available on V8)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, BridgeError);
        }
    }

    public static fromSolidityError(error: any): BridgeError {
        // Extract error signature and arguments from revert data
        const errorSignature = error.signature || '';
        const errorName = errorSignature.split('(')[0];
        const errorType = errorName as BridgeErrorType;
        
        return new BridgeError({
            type: errorType,
            message: this.formatErrorMessage(errorType, error.args),
            details: error.args,
        });
    }

    private static formatErrorMessage(type: BridgeErrorType, args: any): string {
        switch (type) {
            case BridgeErrorType.Unauthorized:
                return `Unauthorized caller ${args.caller}. Required role: ${args.requiredRole}`;
            case BridgeErrorType.InsufficientSignatures:
                return `Insufficient signatures: ${args.current}/${args.required}`;
            case BridgeErrorType.InvalidRole:
                return `Invalid role: ${args.role}`;
            case BridgeErrorType.TokenNotRegistered:
                return `Token not registered: ${args.token}`;
            case BridgeErrorType.InvalidChainId:
                return `Invalid chain ID: ${args.chainId}`;
            case BridgeErrorType.CrossChainRequestFailed:
                return `Cross-chain request failed on chain ${args.targetChainId} for tx ${args.txHash}`;
            // Add more cases as needed
            default:
                return `Bridge error: ${type}`;
        }
    }
}