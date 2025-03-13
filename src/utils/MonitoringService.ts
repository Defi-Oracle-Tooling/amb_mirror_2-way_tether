export enum AlertLevel {
    INFO = "INFO",
    WARNING = "WARNING",
    ERROR = "ERROR",
    CRITICAL = "CRITICAL"
}

// Enhanced transaction log with chain information
export type TransactionLog = {
    hash: string;
    type: string;
    timestamp: number;
    sourceChainId?: number;
    destinationChainId?: number;
    status: 'PENDING' | 'COMPLETED' | 'FAILED';
    metadata: Record<string, any>;
};

// Enhanced metrics collection
export type BridgeMetrics = {
    totalTransactions: number;
    successfulTransactions: number;
    failedTransactions: number;
    averageConfirmationTime: number; // in milliseconds
    transactionsByChain: Record<number, number>;
    failureRate: number;
    lastUpdated: number;
};

export type AlertConfig = {
    level: AlertLevel;
    message: string;
    metadata?: Record<string, any>;
    callback?: (alert: Alert) => Promise<void>;
};

export type Alert = AlertConfig & {
    id: string;
    timestamp: number;
};

export class MonitoringService {
    private txLogs: TransactionLog[] = [];
    private alerts: Alert[] = [];
    private alertCallbacks: ((alert: Alert) => Promise<void>)[] = [];
    private bridgeMetrics: BridgeMetrics;
    private metricsUpdateInterval: NodeJS.Timeout | null = null;
    private anomalyDetectionThresholds: {
        failureRateThreshold: number;
        responseTimeThreshold: number; // in milliseconds
        maxFailuresPerMinute: number;
    };

    constructor(options: {
        failureRateThreshold?: number,
        responseTimeThreshold?: number,
        maxFailuresPerMinute?: number,
        metricsUpdateIntervalMs?: number
    } = {}) {
        // Initialize metrics
        this.bridgeMetrics = {
            totalTransactions: 0,
            successfulTransactions: 0,
            failedTransactions: 0,
            averageConfirmationTime: 0,
            transactionsByChain: {},
            failureRate: 0,
            lastUpdated: Date.now()
        };

        // Initialize anomaly detection thresholds
        this.anomalyDetectionThresholds = {
            failureRateThreshold: options.failureRateThreshold || 0.1, // 10% failure rate
            responseTimeThreshold: options.responseTimeThreshold || 30000, // 30 seconds
            maxFailuresPerMinute: options.maxFailuresPerMinute || 5
        };

        // Initialize with default error handler
        this.addAlertCallback(async (alert) => {
            if (alert.level === AlertLevel.CRITICAL) {
                console.error(`CRITICAL ALERT: ${alert.message}`, alert.metadata);
            }
        });

        // Start metrics update interval
        if (options.metricsUpdateIntervalMs) {
            this.startMetricsUpdate(options.metricsUpdateIntervalMs);
        }
    }

    // Enhanced transaction logging with chain information
    logTransaction(hash: string, type: string, metadata: Record<string, any> = {}) {
        const log: TransactionLog = {
            hash,
            type,
            timestamp: Date.now(),
            sourceChainId: metadata.sourceChainId,
            destinationChainId: metadata.destinationChainId,
            status: type.includes("FAILED") ? 'FAILED' : 
                   type.includes("COMPLETED") ? 'COMPLETED' : 'PENDING',
            metadata
        };
        this.txLogs.push(log);
        
        // Update metrics
        this.updateMetricsOnNewTransaction(log);
        
        // Emit appropriate alerts based on transaction type
        this.checkTransactionAlert(log);

        // Perform anomaly detection
        this.detectAnomalies();

        return log;
    }

    // Update transaction status
    updateTransactionStatus(hash: string, status: 'PENDING' | 'COMPLETED' | 'FAILED', metadata: Record<string, any> = {}) {
        const transaction = this.txLogs.find(tx => tx.hash === hash);
        if (transaction) {
            const oldStatus = transaction.status;
            transaction.status = status;
            transaction.metadata = { ...transaction.metadata, ...metadata };
            
            // Update metrics based on status change
            if (oldStatus !== status) {
                if (status === 'COMPLETED') {
                    this.bridgeMetrics.successfulTransactions++;
                    
                    // Calculate confirmation time if we have start time in metadata
                    if (transaction.metadata.startTime) {
                        const confirmationTime = Date.now() - transaction.metadata.startTime;
                        this.updateAverageConfirmationTime(confirmationTime);
                    }
                } else if (status === 'FAILED') {
                    this.bridgeMetrics.failedTransactions++;
                    
                    // Create alert for failed transaction
                    this.createAlert({
                        level: AlertLevel.ERROR,
                        message: `Transaction ${transaction.type} failed`,
                        metadata: {
                            txHash: transaction.hash,
                            sourceChainId: transaction.sourceChainId,
                            destinationChainId: transaction.destinationChainId,
                            ...transaction.metadata
                        }
                    });
                }
                
                // Update failure rate
                this.updateFailureRate();
            }
            
            return transaction;
        }
        return null;
    }

    private checkTransactionAlert(log: TransactionLog) {
        // Alert on failed transactions
        if (log.status === 'FAILED') {
            this.createAlert({
                level: AlertLevel.ERROR,
                message: `Transaction ${log.type} failed`,
                metadata: {
                    txHash: log.hash,
                    sourceChainId: log.sourceChainId,
                    destinationChainId: log.destinationChainId,
                    ...log.metadata
                }
            });
        }
        
        // Alert on governance actions
        if (log.type.startsWith("GOVERNANCE_")) {
            this.createAlert({
                level: AlertLevel.INFO,
                message: `Governance action ${log.type} recorded`,
                metadata: {
                    txHash: log.hash,
                    ...log.metadata
                }
            });
        }

        // Alert on cross-chain transactions
        if (log.sourceChainId && log.destinationChainId && log.sourceChainId !== log.destinationChainId) {
            const alertLevel = log.status === 'FAILED' ? AlertLevel.ERROR : 
                              log.status === 'COMPLETED' ? AlertLevel.INFO : AlertLevel.WARNING;
            
            this.createAlert({
                level: alertLevel,
                message: `Cross-chain transaction ${log.type} ${log.status.toLowerCase()}`,
                metadata: {
                    txHash: log.hash,
                    sourceChainId: log.sourceChainId,
                    destinationChainId: log.destinationChainId,
                    status: log.status,
                    ...log.metadata
                }
            });
        }
    }

    logError(type: string, error: Error | unknown, metadata: Record<string, any> = {}) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        const alertLevel = type.includes("CRITICAL") ? AlertLevel.CRITICAL : AlertLevel.ERROR;
        
        this.createAlert({
            level: alertLevel,
            message: `${type}: ${errorMessage}`,
            metadata: {
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined,
                ...metadata
            }
        });
    }

    createAlert(config: AlertConfig) {
        const alert: Alert = {
            ...config,
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now()
        };
        this.alerts.push(alert);
        this.notifyAlertCallbacks(alert);
        return alert;
    }

    addAlertCallback(callback: (alert: Alert) => Promise<void>) {
        this.alertCallbacks.push(callback);
        return this;
    }

    private async notifyAlertCallbacks(alert: Alert) {
        await Promise.all(
            this.alertCallbacks.map(callback => 
                callback(alert).catch(err => 
                    console.error("Alert callback failed:", err)
                )
            )
        );
        // Also call the alert's specific callback if provided
        if (alert.callback) {
            try {
                await alert.callback(alert);
            } catch (err) {
                console.error("Alert-specific callback failed:", err);
            }
        }
    }

    // Enhanced metrics methods
    private updateMetricsOnNewTransaction(log: TransactionLog) {
        this.bridgeMetrics.totalTransactions++;
        
        // Update chain-specific metrics
        if (log.sourceChainId) {
            this.bridgeMetrics.transactionsByChain[log.sourceChainId] = 
                (this.bridgeMetrics.transactionsByChain[log.sourceChainId] || 0) + 1;
        }
        
        // Update status-specific metrics
        if (log.status === 'COMPLETED') {
            this.bridgeMetrics.successfulTransactions++;
        } else if (log.status === 'FAILED') {
            this.bridgeMetrics.failedTransactions++;
        }
        
        // Update failure rate
        this.updateFailureRate();
        
        // Update timestamp
        this.bridgeMetrics.lastUpdated = Date.now();
    }

    private updateFailureRate() {
        if (this.bridgeMetrics.totalTransactions > 0) {
            this.bridgeMetrics.failureRate = 
                this.bridgeMetrics.failedTransactions / this.bridgeMetrics.totalTransactions;
        }
    }

    private updateAverageConfirmationTime(newConfirmationTime: number) {
        const oldTotal = this.bridgeMetrics.averageConfirmationTime * (this.bridgeMetrics.successfulTransactions - 1);
        const newTotal = oldTotal + newConfirmationTime;
        this.bridgeMetrics.averageConfirmationTime = newTotal / this.bridgeMetrics.successfulTransactions;
    }

    // Anomaly detection
    private detectAnomalies() {
        // Check failure rate threshold
        if (this.bridgeMetrics.failureRate > this.anomalyDetectionThresholds.failureRateThreshold) {
            this.createAlert({
                level: AlertLevel.WARNING,
                message: `High transaction failure rate detected: ${(this.bridgeMetrics.failureRate * 100).toFixed(1)}%`,
                metadata: {
                    currentRate: this.bridgeMetrics.failureRate,
                    threshold: this.anomalyDetectionThresholds.failureRateThreshold,
                    totalTransactions: this.bridgeMetrics.totalTransactions,
                    failedTransactions: this.bridgeMetrics.failedTransactions
                }
            });
        }
        
        // Check for recent failures (in the last minute)
        const recentFailures = this.txLogs.filter(
            log => log.status === 'FAILED' && 
            log.timestamp > Date.now() - 60000
        ).length;
        
        if (recentFailures >= this.anomalyDetectionThresholds.maxFailuresPerMinute) {
            this.createAlert({
                level: AlertLevel.CRITICAL,
                message: `High failure rate in the last minute: ${recentFailures} failures`,
                metadata: {
                    recentFailures,
                    threshold: this.anomalyDetectionThresholds.maxFailuresPerMinute,
                    timeWindow: '1 minute'
                }
            });
        }
        
        // Check average confirmation time
        if (this.bridgeMetrics.averageConfirmationTime > this.anomalyDetectionThresholds.responseTimeThreshold) {
            this.createAlert({
                level: AlertLevel.WARNING,
                message: `Slow average confirmation time: ${(this.bridgeMetrics.averageConfirmationTime / 1000).toFixed(1)}s`,
                metadata: {
                    averageTime: this.bridgeMetrics.averageConfirmationTime,
                    threshold: this.anomalyDetectionThresholds.responseTimeThreshold
                }
            });
        }
    }

    // Periodic metrics update
    startMetricsUpdate(intervalMs: number = 60000) { // Default 1 minute
        if (this.metricsUpdateInterval) {
            clearInterval(this.metricsUpdateInterval);
        }
        
        this.metricsUpdateInterval = setInterval(() => {
            this.updateMetrics();
            this.detectAnomalies();
        }, intervalMs);
    }
    
    stopMetricsUpdate() {
        if (this.metricsUpdateInterval) {
            clearInterval(this.metricsUpdateInterval);
            this.metricsUpdateInterval = null;
        }
    }
    
    private updateMetrics() {
        // Perform any periodic metrics updates here
        this.updateFailureRate();
        this.bridgeMetrics.lastUpdated = Date.now();
    }

    // Query methods
    getRecentTransactions(limit: number = 100, filter?: {
        status?: 'PENDING' | 'COMPLETED' | 'FAILED',
        sourceChainId?: number,
        destinationChainId?: number,
        type?: string
    }): TransactionLog[] {
        let filteredLogs = [...this.txLogs];
        
        if (filter) {
            if (filter.status) {
                filteredLogs = filteredLogs.filter(log => log.status === filter.status);
            }
            if (filter.sourceChainId !== undefined) {
                filteredLogs = filteredLogs.filter(log => log.sourceChainId === filter.sourceChainId);
            }
            if (filter.destinationChainId !== undefined) {
                filteredLogs = filteredLogs.filter(log => log.destinationChainId === filter.destinationChainId);
            }
            if (filter.type) {
                filteredLogs = filteredLogs.filter(log => log.type.includes(filter.type));
            }
        }
        
        return filteredLogs
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    getRecentAlerts(
        options: {
            level?: AlertLevel,
            limit?: number,
            since?: number, // timestamp, defaults to last 24 hours
            messageContains?: string
        } = {}
    ): Alert[] {
        const { level, limit = 100, since = Date.now() - 24 * 60 * 60 * 1000, messageContains } = options;
        
        return [...this.alerts]
            .filter(alert => (!level || alert.level === level) && 
                            alert.timestamp >= since &&
                            (!messageContains || alert.message.includes(messageContains)))
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    getMetrics(): BridgeMetrics {
        return { ...this.bridgeMetrics };
    }
    
    getMetricsByChain(chainId: number): {
        totalTransactions: number;
        successRate: number;
    } {
        const chainTxs = this.bridgeMetrics.transactionsByChain[chainId] || 0;
        const successfulChainTxs = this.txLogs.filter(
            log => log.sourceChainId === chainId && log.status === 'COMPLETED'
        ).length;
        
        return {
            totalTransactions: chainTxs,
            successRate: chainTxs > 0 ? successfulChainTxs / chainTxs : 0
        };
    }
    
    // Cross-chain specific monitoring methods
    getCrossChainLatency(sourceChainId: number, destinationChainId: number): number {
        const crossChainTxs = this.txLogs.filter(
            log => log.sourceChainId === sourceChainId && 
                  log.destinationChainId === destinationChainId &&
                  log.status === 'COMPLETED' &&
                  log.metadata.startTime &&
                  log.metadata.endTime
        );
        
        if (crossChainTxs.length === 0) {
            return 0;
        }
        
        const totalLatency = crossChainTxs.reduce(
            (sum, tx) => sum + (tx.metadata.endTime - tx.metadata.startTime),
            0
        );
        
        return totalLatency / crossChainTxs.length;
    }

    // Cleanup old logs
    cleanup(maxAge: number = 24 * 60 * 60 * 1000) { // Default 24 hours
        const cutoff = Date.now() - maxAge;
        this.txLogs = this.txLogs.filter(log => log.timestamp >= cutoff);
        this.alerts = this.alerts.filter(alert => alert.timestamp >= cutoff);
    }
    
    // For testing and debugging
    reset() {
        this.txLogs = [];
        this.alerts = [];
        this.bridgeMetrics = {
            totalTransactions: 0,
            successfulTransactions: 0,
            failedTransactions: 0,
            averageConfirmationTime: 0,
            transactionsByChain: {},
            failureRate: 0,
            lastUpdated: Date.now()
        };
        this.stopMetricsUpdate();
    }
}