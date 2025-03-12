export enum BridgeRole {
    NONE = 0,
    OPERATOR = 1,
    ADMIN = 2,
    GUARDIAN = 3
}

export interface ChainConfig {
    chainId: number;
    name: string;
    isSupported: boolean;
    rpcUrl: string;
}

export interface BridgeFeature {
    name: string;
    enabled: boolean;
    description: string;
    requiredRole: BridgeRole;
}

export interface PendingTransaction {
    hash: string;
    target: string;
    value: string;
    data: string;
    proposer: string;
    signatureCount: number;
    requiredSignatures: number;
    proposedAt: number;
    signers: string[];
}

export interface BridgeStats {
    totalTransactions: number;
    activeOperators: number;
    supportedChains: number;
    pendingActions: number;
}

export interface OperatorInfo {
    address: string;
    role: BridgeRole;
    totalTransactions: number;
    lastActive: number;
}

export interface BridgeAction {
    type: 'TOGGLE_FEATURE' | 'UPDATE_CHAIN' | 'UPDATE_ROLE' | 'UPDATE_THRESHOLD';
    params: Record<string, any>;
    description: string;
}

// Bridge configuration types
export interface BridgeConfig {
    features: BridgeFeature[];
    chains: ChainConfig[];
    governance: {
        threshold: number;
        minDelay: number;
        guardianDelay: number;
    };
    monitoring: {
        errorThreshold: number;
        alertInterval: number;
        maxRetries: number;
    };
}