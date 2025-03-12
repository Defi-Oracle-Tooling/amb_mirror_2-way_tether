import { ethers } from 'ethers';
import type { BridgeConfig, FeatureFlag } from '../admin-panel/types/config';
import { MonitoringService, AlertLevel } from '../utils/MonitoringService';

export class BridgeError extends Error {
    constructor(message: string, public readonly code: string, public readonly details?: any) {
        super(message);
        this.name = 'BridgeError';
    }
}

export interface RetryConfig {
    maxAttempts: number;
    initialDelay: number;
    maxDelay: number;
    backoffFactor: number;
}

export class BridgeService {
    private provider: ethers.Provider;
    private signer: ethers.Signer | null;
    private bridgeContract: ethers.Contract;
    private governanceContract: ethers.Contract;
    private monitoring: MonitoringService;
    private retryConfig: RetryConfig;

    constructor(
        provider: ethers.Provider,
        bridgeAddress: string,
        governanceAddress: string,
        bridgeAbi: any,
        governanceAbi: any,
        monitoring: MonitoringService,
        retryConfig?: Partial<RetryConfig>
    ) {
        this.provider = provider;
        this.signer = null;
        this.bridgeContract = new ethers.Contract(bridgeAddress, bridgeAbi, provider);
        this.governanceContract = new ethers.Contract(governanceAddress, governanceAbi, provider);
        this.monitoring = monitoring;
        this.retryConfig = {
            maxAttempts: retryConfig?.maxAttempts ?? 3,
            initialDelay: retryConfig?.initialDelay ?? 1000,
            maxDelay: retryConfig?.maxDelay ?? 10000,
            backoffFactor: retryConfig?.backoffFactor ?? 2
        };
    }

    private async retry<T>(
        operation: () => Promise<T>,
        context: string
    ): Promise<T> {
        let lastError: Error | null = null;
        let delay = this.retryConfig.initialDelay;

        for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error as Error;
                if (attempt === this.retryConfig.maxAttempts) {
                    throw new BridgeError(
                        `Failed to ${context} after ${attempt} attempts`,
                        'OPERATION_FAILED',
                        { originalError: lastError }
                    );
                }
                
                await new Promise(resolve => setTimeout(resolve, delay));
                delay = Math.min(
                    delay * this.retryConfig.backoffFactor,
                    this.retryConfig.maxDelay
                );
            }
        }
        
        throw lastError;
    }

    private async getSigner(): Promise<ethers.Signer> {
        if (!this.signer) {
            if ('getSigner' in this.provider) {
                this.signer = (this.provider as any).getSigner();
            } else {
                throw new Error('No signer available');
            }
        }
        if (!this.signer) {
            throw new Error('Failed to get signer');
        }
        return this.signer;
    }

    async getFeatureFlags(): Promise<FeatureFlag[]> {
        return this.retry(async () => {
            const features: FeatureFlag[] = [];
            // Implementation will depend on contract storage structure
            // This is a placeholder for the actual implementation
            return features;
        }, "fetch feature flags");
    }

    async toggleFeature(feature: string, enabled: boolean): Promise<void> {
        const signer = await this.getSigner();
        const bridgeWithSigner = this.bridgeContract.connect(signer);
        
        try {
            const tx = await (bridgeWithSigner as any).toggleFeature(feature, enabled);
            await tx.wait();
            
            this.monitoring.emitAlert({
                level: AlertLevel.INFO,
                message: `Feature ${feature} ${enabled ? 'enabled' : 'disabled'} successfully`,
                timestamp: new Date()
            });
        } catch (error) {
            this.monitoring.emitAlert({
                level: AlertLevel.ERROR,
                message: `Failed to toggle feature ${feature}`,
                timestamp: new Date(),
                data: error
            });
            throw new BridgeError(
                `Failed to toggle feature ${feature}`,
                'FEATURE_TOGGLE_FAILED',
                error
            );
        }
    }

    async proposeTransaction(
        target: string,
        value: bigint,
        data: string
    ): Promise<string> {
        return this.retry(async () => {
            const signer = await this.getSigner();
            const govWithSigner = this.governanceContract.connect(signer);
            
            const tx = await (govWithSigner as any).proposeTransaction(
                target,
                value,
                data
            );
            const receipt = await tx.wait();
            const txHash = receipt.logs[0].topics[1];
            
            const network = await this.provider.getNetwork();
            this.monitoring.trackTransaction(
                txHash,
                Number(network.chainId), // Convert to number for monitoring service
                0 // Target chain ID will be determined by the transaction data
            );
            
            return txHash;
        }, "propose transaction");
    }

    async signTransaction(txHash: string): Promise<void> {
        await this.retry(async () => {
            const signer = await this.getSigner();
            const govWithSigner = this.governanceContract.connect(signer);
            const tx = await (govWithSigner as any).signTransaction(txHash);
            await tx.wait();
            
            const sigCount = await this.getSignatureCount(txHash);
            const threshold = await this.getThreshold();
            
            if (sigCount >= threshold) {
                this.monitoring.emitAlert({
                    level: AlertLevel.INFO,
                    message: `Transaction ${txHash} has reached signature threshold`,
                    timestamp: new Date(),
                    data: { sigCount, threshold }
                });
            }
        }, "sign transaction");
    }

    async executeTransaction(txHash: string): Promise<void> {
        await this.retry(async () => {
            const signer = await this.getSigner();
            const govWithSigner = this.governanceContract.connect(signer);
            const tx = await (govWithSigner as any).executeTransaction(txHash);
            const receipt = await tx.wait();
            
            this.monitoring.confirmTransaction(txHash, true);
            
            this.monitoring.emitAlert({
                level: AlertLevel.INFO,
                message: `Transaction ${txHash} executed successfully`,
                timestamp: new Date(),
                data: { blockNumber: receipt.blockNumber }
            });
        }, "execute transaction");
    }

    async getSignatureCount(txHash: string): Promise<number> {
        return this.retry(
            () => this.governanceContract.getSignatureCount(txHash),
            "get signature count"
        );
    }

    async getThreshold(): Promise<number> {
        return this.retry(
            () => this.governanceContract.getThreshold(),
            "get threshold"
        );
    }

    async hasRole(account: string, role: number): Promise<boolean> {
        return this.retry(
            () => this.governanceContract.hasRole(account, role),
            "check role"
        );
    }

    async getTransactionStatus(txHash: string): Promise<{
        exists: boolean;
        executed: boolean;
        sigCount: number;
        threshold: number;
    }> {
        try {
            const [sigCount, threshold] = await Promise.all([
                this.getSignatureCount(txHash),
                this.getThreshold()
            ]);

            return {
                exists: true,
                executed: false, // This would need to be fetched from the contract
                sigCount,
                threshold
            };
        } catch (error) {
            if ((error as Error).message.includes("Transaction does not exist")) {
                return {
                    exists: false,
                    executed: false,
                    sigCount: 0,
                    threshold: await this.getThreshold()
                };
            }
            throw error;
        }
    }
}