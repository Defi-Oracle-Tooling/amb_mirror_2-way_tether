import { ethers } from 'ethers';
import type { Provider } from '@ethersproject/providers';
import { EventEmitter } from 'events';

export class MonitoringService extends EventEmitter {
    private readonly provider: Provider;
    private readonly bridgeAddress: string;
    private errorThresholds: Map<string, number>;
    private errorCounts: Map<string, number>;
    private lastAlertTime: Map<string, number>;
    private readonly alertCooldown: number = 3600; // 1 hour in seconds

    constructor(provider: Provider, bridgeAddress: string) {
        super();
        this.provider = provider;
        this.bridgeAddress = bridgeAddress;
        this.errorThresholds = new Map();
        this.errorCounts = new Map();
        this.lastAlertTime = new Map();
        this.initializeErrorThresholds();
    }

    private initializeErrorThresholds() {
        this.errorThresholds.set('UnauthorizedAccess', 3);
        this.errorThresholds.set('TransferFailed', 2);
        this.errorThresholds.set('BridgeOperationFailed', 2);
        this.errorThresholds.set('ProofAlreadyUsed', 1);
        this.errorThresholds.set('SystemPaused', 1);
    }

    public async startMonitoring(): Promise<void> {
        const bridgeInterface = new ethers.utils.Interface([
            'event ErrorLogged(string indexed errorType, string message, address indexed actor, uint256 timestamp)'
        ]);

        this.provider.on({
            address: this.bridgeAddress,
            topics: [bridgeInterface.getEventTopic('ErrorLogged')]
        }, (log) => this.handleErrorLog(log));

        // Monitor for critical events
        await this.monitorHealthMetrics();
    }

    private async handleErrorLog(log: any): Promise<void> {
        const bridgeInterface = new ethers.utils.Interface([
            'event ErrorLogged(string indexed errorType, string message, address indexed actor, uint256 timestamp)'
        ]);
        
        const parsedLog = bridgeInterface.parseLog(log);
        const { errorType, message, actor, timestamp } = parsedLog.args;

        // Update error counts
        const currentCount = (this.errorCounts.get(errorType) || 0) + 1;
        this.errorCounts.set(errorType, currentCount);

        // Check if we should trigger an alert
        const threshold = this.errorThresholds.get(errorType);
        if (threshold && currentCount >= threshold) {
            await this.triggerAlert(errorType, message, actor, currentCount);
        }

        // Emit monitoring event
        this.emit('error', {
            errorType,
            message,
            actor,
            timestamp: new Date(timestamp.toNumber() * 1000),
            count: currentCount
        });
    }

    private async triggerAlert(
        errorType: string,
        message: string,
        actor: string,
        count: number
    ): Promise<void> {
        const now = Math.floor(Date.now() / 1000);
        const lastAlert = this.lastAlertTime.get(errorType) || 0;

        // Check cooldown period
        if (now - lastAlert >= this.alertCooldown) {
            this.lastAlertTime.set(errorType, now);
            
            const alert = {
                type: errorType,
                message,
                actor,
                count,
                timestamp: new Date(),
                severity: this.getSeverityLevel(errorType, count)
            };

            this.emit('alert', alert);
            
            // Reset counter after alert
            this.errorCounts.set(errorType, 0);
        }
    }

    private getSeverityLevel(errorType: string, count: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
        const threshold = this.errorThresholds.get(errorType) || 5;
        
        if (count >= threshold * 3) return 'CRITICAL';
        if (count >= threshold * 2) return 'HIGH';
        if (count >= threshold) return 'MEDIUM';
        return 'LOW';
    }

    private async monitorHealthMetrics(): Promise<void> {
        setInterval(async () => {
            try {
                const latestBlock = await this.provider.getBlock('latest');
                const timestamp = latestBlock.timestamp;
                const now = Math.floor(Date.now() / 1000);

                // Alert if block is too old (more than 5 minutes)
                if (now - timestamp > 300) {
                    this.emit('alert', {
                        type: 'BlockDelay',
                        message: `Block timestamp is ${now - timestamp} seconds old`,
                        severity: 'HIGH',
                        timestamp: new Date()
                    });
                }
            } catch (error) {
                this.emit('error', {
                    type: 'MonitoringError',
                    message: `Failed to fetch health metrics: ${error.message}`,
                    timestamp: new Date()
                });
            }
        }, 60000); // Check every minute
    }

    public updateErrorThreshold(errorType: string, threshold: number): void {
        if (threshold < 1) throw new Error('Threshold must be greater than 0');
        this.errorThresholds.set(errorType, threshold);
    }

    public getErrorCount(errorType: string): number {
        return this.errorCounts.get(errorType) || 0;
    }

    public resetErrorCount(errorType: string): void {
        this.errorCounts.set(errorType, 0);
    }

    public stop(): void {
        this.removeAllListeners();
        this.provider.removeAllListeners();
    }
}