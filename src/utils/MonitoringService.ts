export enum AlertLevel {
    INFO = "INFO",
    WARNING = "WARNING",
    ERROR = "ERROR",
    CRITICAL = "CRITICAL"
}

export type TransactionLog = {
    hash: string;
    type: string;
    timestamp: number;
    metadata: Record<string, any>;
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

    constructor() {
        // Initialize with default error handler
        this.addAlertCallback(async (alert) => {
            if (alert.level === AlertLevel.CRITICAL) {
                console.error(`CRITICAL ALERT: ${alert.message}`, alert.metadata);
            }
        });
    }

    logTransaction(hash: string, type: string, metadata: Record<string, any> = {}) {
        const log: TransactionLog = {
            hash,
            type,
            timestamp: Date.now(),
            metadata
        };
        this.txLogs.push(log);
        
        // Emit appropriate alerts based on transaction type
        this.checkTransactionAlert(log);
    }

    private checkTransactionAlert(log: TransactionLog) {
        // Alert on failed transactions
        if (log.type.includes("FAILED")) {
            this.createAlert({
                level: AlertLevel.ERROR,
                message: `Transaction ${log.type} failed`,
                metadata: {
                    txHash: log.hash,
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
    }

    logError(type: string, error: Error | unknown, metadata: Record<string, any> = {}) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        this.createAlert({
            level: AlertLevel.ERROR,
            message: `${type}: ${errorMessage}`,
            metadata: {
                error: errorMessage,
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
    }

    addAlertCallback(callback: (alert: Alert) => Promise<void>) {
        this.alertCallbacks.push(callback);
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

    // Query methods
    getRecentTransactions(limit: number = 100): TransactionLog[] {
        return [...this.txLogs]
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    getRecentAlerts(level?: AlertLevel, limit: number = 100): Alert[] {
        return [...this.alerts]
            .filter(alert => !level || alert.level === level)
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    // Cleanup old logs
    cleanup(maxAge: number = 24 * 60 * 60 * 1000) { // Default 24 hours
        const cutoff = Date.now() - maxAge;
        this.txLogs = this.txLogs.filter(log => log.timestamp >= cutoff);
        this.alerts = this.alerts.filter(alert => alert.timestamp >= cutoff);
    }
}