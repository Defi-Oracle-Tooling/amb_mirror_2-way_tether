import { ethers, Contract, ContractTransactionResponse, Log } from 'ethers';
import { MonitoringService, AlertLevel } from '../utils/MonitoringService';

export type ChainConfig = {
    chainId: number;
    name: string;
    rpc: string;
    confirmations: number;
    expectedBlockTime: number; // ms
};

export class BridgeService {
    private bridge: Contract;
    private governance: Contract;
    private monitoring: MonitoringService;
    private supportedChains: Map<number, ChainConfig> = new Map();
    private transactionTracker: Map<string, {
        sourceChainId: number;
        destinationChainId: number;
        startTime: number;
        status: 'PENDING' | 'COMPLETED' | 'FAILED';
    }> = new Map();

    constructor(
        bridge: Contract,
        governance: Contract,
        monitoring: MonitoringService,
        supportedChains: ChainConfig[] = []
    ) {
        this.bridge = bridge;
        this.governance = governance;
        this.monitoring = monitoring;
        
        // Initialize supported chains
        supportedChains.forEach(chain => {
            this.supportedChains.set(chain.chainId, chain);
        });
        
        // Set up periodic health check
        this.startHealthCheck();
    }
    
    // Add/update supported chain
    addSupportedChain(chain: ChainConfig): void {
        this.supportedChains.set(chain.chainId, chain);
    }
    
    // Get all supported chains
    getSupportedChains(): ChainConfig[] {
        return Array.from(this.supportedChains.values());
    }
    
    // Check if chain is supported
    isChainSupported(chainId: number): Promise<boolean> {
        return this.bridge.isChainSupported(chainId);
    }

    async mirrorTransaction(
        sourceChainId: number,
        sourceAddress: string,
        transactionHash: string,
        data: string,
        destinationChainId?: number
    ): Promise<ContractTransactionResponse> {
        const startTime = Date.now();
        let txTrackingId: string | undefined;
        
        try {
            // Verify chain support
            const isSupported = await this.bridge.isChainSupported(sourceChainId);
            if (!isSupported) {
                throw new Error(`Chain ID ${sourceChainId} not supported`);
            }

            // Current chain ID (destination)
            const currentChainId = destinationChainId || await this.getChainId();
            
            // Check if CROSS_CHAIN_MIRROR feature is enabled
            const isEnabled = await this.bridge.isFeatureEnabled("CROSS_CHAIN_MIRROR");
            if (!isEnabled) {
                throw new Error("Cross-chain mirroring is not enabled");
            }

            // Create hash for tracking this cross-chain transaction
            const hashedTx = ethers.keccak256(ethers.toUtf8Bytes(transactionHash));
            txTrackingId = `${sourceChainId}-${currentChainId}-${hashedTx.slice(2, 10)}`;
            
            // Track the transaction
            this.transactionTracker.set(txTrackingId, {
                sourceChainId,
                destinationChainId: currentChainId,
                startTime,
                status: 'PENDING'
            });

            // Execute transaction
            const tx = await this.bridge.mirrorTransaction(
                sourceChainId,
                sourceAddress,
                hashedTx,
                data
            );
            
            // Monitor transaction with enhanced data
            this.monitoring.logTransaction(tx.hash, "MIRROR_TX", {
                txTrackingId,
                sourceChainId,
                destinationChainId: currentChainId,
                sourceAddress,
                sourceTransactionHash: transactionHash,
                startTime,
                status: 'PENDING'
            });
            
            // Set up event listener for transaction completion
            this.setupTransactionConfirmationTracking(tx.hash, txTrackingId, sourceChainId, currentChainId);
            
            return tx;
        } catch (error) {
            // Update transaction status to failed
            if (txTrackingId) {
                this.transactionTracker.set(txTrackingId, {
                    sourceChainId,
                    destinationChainId: destinationChainId || 0,
                    startTime,
                    status: 'FAILED'
                });
            }
            
            this.monitoring.logError("MIRROR_TX_FAILED", error, {
                sourceChainId,
                destinationChainId,
                sourceAddress,
                transactionHash,
                txTrackingId
            });
            throw error;
        }
    }
    
    // Track transaction confirmation
    private setupTransactionConfirmationTracking(txHash: string, txTrackingId: string, sourceChainId: number, destinationChainId: number): void {
        // This would typically monitor for transaction receipts and completion events
        // For this implementation, we'll simulate with a timeout
        const startTime = Date.now();
        
        // In a real implementation, you would listen for transaction confirmation events
        this.bridge.provider.once(txHash, (receipt) => {
            const endTime = Date.now();
            const duration = endTime - startTime;
            
            if (receipt && receipt.status === 1) {
                // Transaction successful
                this.transactionTracker.set(txTrackingId, {
                    sourceChainId,
                    destinationChainId,
                    startTime,
                    status: 'COMPLETED'
                });
                
                // Update monitoring status
                this.monitoring.updateTransactionStatus(txHash, 'COMPLETED', {
                    txTrackingId,
                    confirmationTime: duration,
                    endTime,
                    blockNumber: receipt.blockNumber
                });
                
                // Log metrics about cross-chain latency
                this.monitoring.logTransaction(txHash, "MIRROR_TX_COMPLETED", {
                    txTrackingId,
                    sourceChainId,
                    destinationChainId,
                    duration,
                    startTime,
                    endTime
                });
            } else {
                // Transaction failed
                this.transactionTracker.set(txTrackingId, {
                    sourceChainId,
                    destinationChainId,
                    startTime,
                    status: 'FAILED'
                });
                
                this.monitoring.updateTransactionStatus(txHash, 'FAILED', {
                    txTrackingId,
                    duration,
                    endTime,
                    error: "Transaction failed on chain"
                });
            }
        });
    }

    async proposeGovernanceAction(
        target: string,
        value: bigint,
        data: string
    ): Promise<string> {
        try {
            // Start tracking the governance action
            const startTime = Date.now();
            
            const tx = await this.governance.proposeTransaction(target, value, data);
            const receipt = await tx.wait();
            
            const event = receipt?.logs.find(
                (log: Log) => {
                    const parsed = this.governance.interface.parseLog(log);
                    return parsed?.name === "TransactionProposed";
                }
            );
            
            if (!event) {
                throw new Error("Transaction proposal failed");
            }

            const parsed = this.governance.interface.parseLog(event);
            const txHash = parsed?.args?.txHash;
            
            // Enhanced transaction logging
            this.monitoring.logTransaction(tx.hash, "GOVERNANCE_PROPOSE", {
                target,
                value: value.toString(),
                governanceHash: txHash,
                startTime,
                endTime: Date.now(),
                duration: Date.now() - startTime
            });

            // Create alert for governance action
            this.monitoring.createAlert({
                level: AlertLevel.INFO,
                message: `New governance action proposed: ${txHash}`,
                metadata: {
                    target,
                    value: value.toString(),
                    txHash: tx.hash,
                    governanceHash: txHash
                }
            });

            return txHash;
        } catch (error) {
            this.monitoring.logError("GOVERNANCE_PROPOSE_FAILED", error, {
                target,
                value: value.toString()
            });
            throw error;
        }
    }

    async getSignatureStatus(txHash: string): Promise<{
        count: number,
        threshold: number,
        isExecutable: boolean
    }> {
        try {
            const [count, threshold] = await Promise.all([
                this.governance.getSignatureCount(txHash),
                this.governance.getThreshold()
            ]);

            const status = {
                count: Number(count),
                threshold: Number(threshold),
                isExecutable: count >= threshold
            };
            
            // Log signature status query for monitoring
            this.monitoring.logTransaction(
                `status-${txHash.slice(0, 10)}-${Date.now()}`, 
                "GOVERNANCE_STATUS_CHECK", 
                {
                    governanceHash: txHash,
                    ...status
                }
            );

            return status;
        } catch (error) {
            this.monitoring.logError("GOVERNANCE_STATUS_CHECK_FAILED", error, { governanceHash: txHash });
            throw error;
        }
    }

    async signGovernanceAction(txHash: string): Promise<ContractTransactionResponse> {
        try {
            const startTime = Date.now();
            
            // Check current status before signing
            const beforeStatus = await this.getSignatureStatus(txHash);
            
            // Sign the transaction
            const tx = await this.governance.signTransaction(txHash);
            await tx.wait();
            
            // Get updated status
            const afterStatus = await this.getSignatureStatus(txHash);
            
            // Enhanced monitoring
            this.monitoring.logTransaction(tx.hash, "GOVERNANCE_SIGN", {
                governanceHash: txHash,
                beforeCount: beforeStatus.count,
                afterCount: afterStatus.count,
                threshold: afterStatus.threshold,
                isNowExecutable: afterStatus.isExecutable,
                startTime,
                endTime: Date.now(),
                duration: Date.now() - startTime
            });
            
            // Alert if transaction is now executable
            if (!beforeStatus.isExecutable && afterStatus.isExecutable) {
                this.monitoring.createAlert({
                    level: AlertLevel.INFO,
                    message: `Governance action ${txHash} is now executable`,
                    metadata: {
                        governanceHash: txHash,
                        signatures: afterStatus.count,
                        threshold: afterStatus.threshold
                    }
                });
            }
            
            return tx;
        } catch (error) {
            this.monitoring.logError("GOVERNANCE_SIGN_FAILED", error, { governanceHash: txHash });
            throw error;
        }
    }

    async executeGovernanceAction(txHash: string): Promise<ContractTransactionResponse> {
        try {
            const startTime = Date.now();
            
            // Check if executable
            const status = await this.getSignatureStatus(txHash);
            if (!status.isExecutable) {
                throw new Error("Insufficient signatures to execute transaction");
            }
            
            // Execute the transaction
            const tx = await this.governance.executeTransaction(txHash);
            const receipt = await tx.wait();
            
            // Enhanced monitoring with execution details
            this.monitoring.logTransaction(tx.hash, "GOVERNANCE_EXECUTE", {
                governanceHash: txHash,
                startTime,
                endTime: Date.now(),
                duration: Date.now() - startTime,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed?.toString(),
                status: receipt.status === 1 ? 'SUCCESS' : 'FAILED'
            });
            
            return tx;
        } catch (error) {
            this.monitoring.logError("GOVERNANCE_EXECUTE_FAILED", error, { governanceHash: txHash });
            throw error;
        }
    }

    // Helper methods for checking state
    async isOperator(address: string): Promise<boolean> {
        return this.governance.hasRole(address, 1); // OPERATOR role
    }

    async isAdmin(address: string): Promise<boolean> {
        return this.governance.hasRole(address, 2); // ADMIN role
    }

    async isGuardian(address: string): Promise<boolean> {
        return this.governance.hasRole(address, 3); // GUARDIAN role
    }
    
    // Bridge health check methods
    async getChainId(): Promise<number> {
        const { chainId } = await this.bridge.provider.getNetwork();
        return Number(chainId);
    }
    
    async getBridgeHealth(): Promise<{
        status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
        issues: string[];
        metrics: {
            totalTransactions: number;
            pendingTransactions: number;
            failureRate: number;
            avgConfirmationTime: number;
        };
    }> {
        try {
            // Get metrics from monitoring service
            const metrics = this.monitoring.getMetrics();
            
            // Calculate pending transactions
            const pendingTxs = Array.from(this.transactionTracker.values())
                .filter(tx => tx.status === 'PENDING').length;
            
            // Determine health status
            const issues: string[] = [];
            let status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' = 'HEALTHY';
            
            if (metrics.failureRate > 0.05) {
                issues.push(`High failure rate: ${(metrics.failureRate * 100).toFixed(1)}%`);
                status = metrics.failureRate > 0.2 ? 'UNHEALTHY' : 'DEGRADED';
            }
            
            if (metrics.averageConfirmationTime > 60000) { // > 1 minute
                issues.push(`Slow confirmation time: ${(metrics.averageConfirmationTime / 1000).toFixed(1)}s`);
                status = metrics.averageConfirmationTime > 300000 ? 'UNHEALTHY' : 'DEGRADED';
            }
            
            if (pendingTxs > 10) {
                issues.push(`High number of pending transactions: ${pendingTxs}`);
                status = pendingTxs > 50 ? 'UNHEALTHY' : 'DEGRADED';
            }
            
            return {
                status,
                issues,
                metrics: {
                    totalTransactions: metrics.totalTransactions,
                    pendingTransactions: pendingTxs,
                    failureRate: metrics.failureRate,
                    avgConfirmationTime: metrics.averageConfirmationTime
                }
            };
        } catch (error) {
            this.monitoring.logError("HEALTH_CHECK_FAILED", error);
            return {
                status: 'UNHEALTHY',
                issues: ['Failed to determine bridge health'],
                metrics: {
                    totalTransactions: 0,
                    pendingTransactions: 0,
                    failureRate: 0,
                    avgConfirmationTime: 0
                }
            };
        }
    }
    
    private startHealthCheck(intervalMs: number = 5 * 60 * 1000): void { // Default 5 minutes
        // Set up periodic health check
        setInterval(async () => {
            try {
                const health = await this.getBridgeHealth();
                
                if (health.status !== 'HEALTHY') {
                    // Create alert based on health status
                    const alertLevel = health.status === 'UNHEALTHY' ? 
                        AlertLevel.CRITICAL : AlertLevel.WARNING;
                        
                    this.monitoring.createAlert({
                        level: alertLevel,
                        message: `Bridge health status: ${health.status}`,
                        metadata: {
                            issues: health.issues,
                            metrics: health.metrics
                        }
                    });
                }
                
                // Also log periodic health check (useful for metrics/dashboards)
                this.monitoring.logTransaction(
                    `health-${Date.now()}`, 
                    "BRIDGE_HEALTH_CHECK",
                    {
                        status: health.status,
                        issues: health.issues,
                        metrics: health.metrics,
                        timestamp: Date.now()
                    }
                );
            } catch (error) {
                this.monitoring.logError("HEALTH_CHECK_ERROR", error);
            }
        }, intervalMs);
    }
    
    // Get transaction status across chains
    async getTransactionStatus(txTrackingId: string): Promise<{
        sourceChainId: number;
        destinationChainId: number;
        status: 'PENDING' | 'COMPLETED' | 'FAILED';
        duration: number;
    } | null> {
        const transaction = this.transactionTracker.get(txTrackingId);
        if (!transaction) {
            return null;
        }
        
        return {
            ...transaction,
            duration: Date.now() - transaction.startTime
        };
    }
}