import { networks } from './networks';
import { BridgeConfig, MonitoringConfig, RetryConfig } from '../../src/admin-panel/types/config';
import dotenv from 'dotenv';

dotenv.config();

const defaultMonitoringConfig: MonitoringConfig = {
    alertThresholds: {
        transactionDelay: 300000, // 5 minutes
        signatureDelay: 180000,   // 3 minutes
        errorRate: 5,             // 5%
        blockConfirmations: 12,
        crossChainLatency: 600000 // 10 minutes
    },
    healthCheckInterval: 30000,   // 30 seconds
    alertEndpoints: [
        {
            url: process.env.SLACK_WEBHOOK_URL || "",
            type: "slack",
            severity: ["error", "critical"]
        },
        {
            url: process.env.EMAIL_WEBHOOK_URL || "",
            type: "email",
            severity: ["critical"]
        }
    ]
};

const defaultRetryConfig: RetryConfig = {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffFactor: 2
};

export interface DeploymentConfig {
    environment: 'local' | 'testnet' | 'mainnet';
    sourceNetworks: string[];
    targetNetworks: string[];
    initialAdmins: string[];
    initialOperators: string[];
    initialGuardians: string[];
    requiredSignatures: number;
    verifyContracts: boolean;
}

const deploymentConfigs: { [key: string]: DeploymentConfig } = {
    local: {
        environment: 'local',
        sourceNetworks: [],
        targetNetworks: [],
        initialAdmins: [],
        initialOperators: [],
        initialGuardians: [],
        requiredSignatures: 1,
        verifyContracts: false
    },
    testnet: {
        environment: 'testnet',
        sourceNetworks: ['goerli', 'mumbai'],
        targetNetworks: ['goerli', 'mumbai'],
        initialAdmins: process.env.TESTNET_ADMINS?.split(',') || [],
        initialOperators: process.env.TESTNET_OPERATORS?.split(',') || [],
        initialGuardians: process.env.TESTNET_GUARDIANS?.split(',') || [],
        requiredSignatures: 2,
        verifyContracts: true
    },
    mainnet: {
        environment: 'mainnet',
        sourceNetworks: ['ethereum', 'polygon', 'arbitrum', 'optimism'],
        targetNetworks: ['ethereum', 'polygon', 'arbitrum', 'optimism'],
        initialAdmins: process.env.MAINNET_ADMINS?.split(',') || [],
        initialOperators: process.env.MAINNET_OPERATORS?.split(',') || [],
        initialGuardians: process.env.MAINNET_GUARDIANS?.split(',') || [],
        requiredSignatures: 3,
        verifyContracts: true
    }
};

export function getDeploymentConfig(environment: string): DeploymentConfig {
    const config = deploymentConfigs[environment];
    if (!config) {
        throw new Error(`Invalid environment: ${environment}`);
    }
    return config;
}

export function generateBridgeConfig(deployConfig: DeploymentConfig): BridgeConfig {
    return {
        sourceNetworks: deployConfig.sourceNetworks.map(name => networks[name]),
        targetNetworks: deployConfig.targetNetworks.map(name => networks[name]),
        features: [],
        admins: deployConfig.initialAdmins,
        operators: deployConfig.initialOperators,
        guardians: deployConfig.initialGuardians,
        requiredSignatures: deployConfig.requiredSignatures,
        monitoring: defaultMonitoringConfig,
        retry: defaultRetryConfig
    };
}

export function validateDeploymentConfig(config: DeploymentConfig): void {
    if (config.initialAdmins.length === 0) {
        throw new Error("No initial admins configured");
    }

    if (config.requiredSignatures > config.initialAdmins.length) {
        throw new Error("Required signatures cannot be greater than number of admins");
    }

    const invalidNetworks = [
        ...config.sourceNetworks.filter(name => !networks[name]),
        ...config.targetNetworks.filter(name => !networks[name])
    ];

    if (invalidNetworks.length > 0) {
        throw new Error(`Invalid networks configured: ${invalidNetworks.join(", ")}`);
    }
}

export function getNetworkConfig(networkName: string) {
    const config = networks[networkName];
    if (!config) {
        throw new Error(`Network configuration not found for: ${networkName}`);
    }
    return config;
}