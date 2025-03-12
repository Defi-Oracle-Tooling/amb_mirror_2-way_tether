export interface NetworkConfig {
    chainId: number;
    rpcUrl: string;
    name: string;
    explorerUrl: string;
    isSource: boolean;
    isTarget: boolean;
    requiredConfirmations: number;
}

export interface FeatureFlag {
    name: string;
    description: string;
    enabled: boolean;
    lastUpdated: Date;
    updatedBy: string;
    requiredRoles: string[];
    environments: string[];
}

export interface RetryConfig {
    maxAttempts: number;
    initialDelay: number;
    maxDelay: number;
    backoffFactor: number;
}

export interface MonitoringConfig {
    alertThresholds: {
        transactionDelay: number;
        signatureDelay: number;
        errorRate: number;
        blockConfirmations: number;
        crossChainLatency: number;
    };
    healthCheckInterval: number;
    alertEndpoints: {
        url: string;
        type: 'email' | 'slack' | 'webhook';
        severity: ('info' | 'warning' | 'error' | 'critical')[];
    }[];
}

export interface BridgeConfig {
    sourceNetworks: NetworkConfig[];
    targetNetworks: NetworkConfig[];
    features: FeatureFlag[];
    admins: string[];
    operators: string[];
    guardians: string[];
    requiredSignatures: number;
    monitoring: MonitoringConfig;
    retry: RetryConfig;
}

export interface ChainConfig {
    bridgeAddress: string;
    governanceAddress: string;
    deploymentBlock: number;
    startBlock?: number;
    syncBatchSize: number;
    maxBlockRange: number;
    webhookEndpoint?: string;
}

export interface AdminPanelConfig {
    apiEndpoint: string;
    refreshInterval: number;
    defaultChainId: number;
    theme: {
        mode: 'light' | 'dark';
        primary: string;
        secondary: string;
    };
    features: {
        enableMetrics: boolean;
        enableAlerts: boolean;
        enableAuditLogs: boolean;
    };
}