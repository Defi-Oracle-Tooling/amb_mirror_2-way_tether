import { EventEmitter } from 'events';
import { ethers } from 'ethers';

export enum AlertLevel {
    INFO = 'info',
    WARNING = 'warning',
    ERROR = 'error',
    CRITICAL = 'critical'
}

export interface Alert {
    level: AlertLevel;
    message: string;
    timestamp: Date;
    data?: any;
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
}

export interface BridgeMetrics {
    totalTransactions: number;
    successfulTransactions: number;
    failedTransactions: number;
    averageLatency: number;
    pendingTransactions: number;
    chainHealth: Map<number, boolean>;
}

export class MonitoringService extends EventEmitter {
    private config: MonitoringConfig;
    private providers: Map<number, ethers.Provider>;
    private lastHealthCheck: Date;
    private alertHistory: Alert[];
    private metrics: BridgeMetrics;
    private transactionTimestamps: Map<string, number>;

    constructor(config: MonitoringConfig) {
        super();
        this.config = config;
        this.providers = new Map();
        this.alertHistory = [];
        this.lastHealthCheck = new Date();
        this.transactionTimestamps = new Map();
        this.metrics = {
            totalTransactions: 0,
            successfulTransactions: 0,
            failedTransactions: 0,
            averageLatency: 0,
            pendingTransactions: 0,
            chainHealth: new Map()
        };
    }

    addNetwork(chainId: number, provider: ethers.Provider): void {
        this.providers.set(chainId, provider);
        this.metrics.chainHealth.set(chainId, true);
    }

    async startMonitoring(): Promise<void> {
        this.monitorChainHealth();
        this.monitorTransactionMetrics();
    }

    private monitorChainHealth(): void {
        setInterval(async () => {
            for (const [chainId, provider] of this.providers) {
                try {
                    const blockNumber = await provider.getBlockNumber();
                    const wasHealthy = this.metrics.chainHealth.get(chainId);
                    this.metrics.chainHealth.set(chainId, true);

                    if (!wasHealthy) {
                        this.emitAlert({
                            level: AlertLevel.INFO,
                            message: `Chain ${chainId} recovered and is now responding`,
                            timestamp: new Date()
                        });
                    }
                } catch (error) {
                    this.metrics.chainHealth.set(chainId, false);
                    this.emitAlert({
                        level: AlertLevel.ERROR,
                        message: `Chain ${chainId} is not responding`,
                        timestamp: new Date(),
                        data: error
                    });
                }
            }
        }, this.config.healthCheckInterval);
    }

    private monitorTransactionMetrics(): void {
        setInterval(() => {
            const now = Date.now();
            for (const [txHash, timestamp] of this.transactionTimestamps) {
                const latency = now - timestamp;
                if (latency > this.config.alertThresholds.crossChainLatency) {
                    this.emitAlert({
                        level: AlertLevel.WARNING,
                        message: `High latency detected for transaction ${txHash}`,
                        timestamp: new Date(),
                        data: { latency, threshold: this.config.alertThresholds.crossChainLatency }
                    });
                }
            }
        }, this.config.healthCheckInterval);
    }

    trackTransaction(txHash: string, sourceChainId: number, targetChainId: number): void {
        this.transactionTimestamps.set(txHash, Date.now());
        this.metrics.totalTransactions++;
        this.metrics.pendingTransactions++;
    }

    confirmTransaction(txHash: string, success: boolean): void {
        const startTime = this.transactionTimestamps.get(txHash);
        if (startTime) {
            const latency = Date.now() - startTime;
            this.updateLatencyMetrics(latency);
            this.transactionTimestamps.delete(txHash);
        }

        this.metrics.pendingTransactions--;
        if (success) {
            this.metrics.successfulTransactions++;
        } else {
            this.metrics.failedTransactions++;
            this.checkErrorRate();
        }
    }

    private updateLatencyMetrics(newLatency: number): void {
        const totalCompleted = this.metrics.successfulTransactions + this.metrics.failedTransactions;
        this.metrics.averageLatency = (
            (this.metrics.averageLatency * totalCompleted + newLatency) / 
            (totalCompleted + 1)
        );
    }

    private checkErrorRate(): void {
        const errorRate = (this.metrics.failedTransactions / this.metrics.totalTransactions) * 100;
        if (errorRate > this.config.alertThresholds.errorRate) {
            this.emitAlert({
                level: AlertLevel.CRITICAL,
                message: `High error rate detected: ${errorRate.toFixed(2)}%`,
                timestamp: new Date(),
                data: { errorRate, threshold: this.config.alertThresholds.errorRate }
            });
        }
    }

    emitAlert(alert: Alert): void {
        this.alertHistory.push(alert);
        this.emit('alert', alert);
    }

    getMetrics(): BridgeMetrics {
        return { ...this.metrics };
    }

    getAlertHistory(startTime?: Date, endTime?: Date): Alert[] {
        if (!startTime && !endTime) return [...this.alertHistory];
        
        return this.alertHistory.filter(alert => {
            const timestamp = alert.timestamp.getTime();
            const isAfterStart = !startTime || timestamp >= startTime.getTime();
            const isBeforeEnd = !endTime || timestamp <= endTime.getTime();
            return isAfterStart && isBeforeEnd;
        });
    }

    getHealthStatus(): {
        lastCheckTime: Date;
        activeNetworks: number[];
        chainHealth: Map<number, boolean>;
        metrics: BridgeMetrics;
    } {
        return {
            lastCheckTime: this.lastHealthCheck,
            activeNetworks: Array.from(this.providers.keys()),
            chainHealth: new Map(this.metrics.chainHealth),
            metrics: this.getMetrics()
        };
    }
}