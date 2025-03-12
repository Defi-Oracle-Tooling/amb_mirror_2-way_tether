import { ethers, Contract, ContractTransactionResponse, Log } from 'ethers';
import { MonitoringService } from '../utils/MonitoringService';

export class BridgeService {
    private bridge: Contract;
    private governance: Contract;
    private monitoring: MonitoringService;

    constructor(
        bridge: Contract,
        governance: Contract,
        monitoring: MonitoringService
    ) {
        this.bridge = bridge;
        this.governance = governance;
        this.monitoring = monitoring;
    }

    async mirrorTransaction(
        sourceChainId: number,
        sourceAddress: string,
        transactionHash: string,
        data: string
    ): Promise<ContractTransactionResponse> {
        try {
            // Verify chain support
            const isSupported = await this.bridge.isChainSupported(sourceChainId);
            if (!isSupported) {
                throw new Error(`Chain ID ${sourceChainId} not supported`);
            }

            // Check if CROSS_CHAIN_MIRROR feature is enabled
            const isEnabled = await this.bridge.isFeatureEnabled("CROSS_CHAIN_MIRROR");
            if (!isEnabled) {
                throw new Error("Cross-chain mirroring is not enabled");
            }

            // Execute transaction
            const tx = await this.bridge.mirrorTransaction(
                sourceChainId,
                sourceAddress,
                ethers.keccak256(ethers.toUtf8Bytes(transactionHash)),
                data
            );

            // Monitor transaction
            this.monitoring.logTransaction(tx.hash, "MIRROR_TX", {
                sourceChainId,
                sourceAddress,
                transactionHash
            });

            return tx;
        } catch (error) {
            this.monitoring.logError("MIRROR_TX_FAILED", error);
            throw error;
        }
    }

    async proposeGovernanceAction(
        target: string,
        value: bigint,
        data: string
    ): Promise<string> {
        try {
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
            
            this.monitoring.logTransaction(tx.hash, "PROPOSE_ACTION", {
                target,
                value: value.toString(),
                txHash
            });

            return txHash;
        } catch (error) {
            this.monitoring.logError("PROPOSE_ACTION_FAILED", error);
            throw error;
        }
    }

    async getSignatureStatus(txHash: string): Promise<{
        count: number,
        threshold: number,
        isExecutable: boolean
    }> {
        const [count, threshold] = await Promise.all([
            this.governance.getSignatureCount(txHash),
            this.governance.getThreshold()
        ]);

        return {
            count: Number(count),
            threshold: Number(threshold),
            isExecutable: count >= threshold
        };
    }

    async executeGovernanceAction(txHash: string): Promise<ContractTransactionResponse> {
        try {
            const status = await this.getSignatureStatus(txHash);
            if (!status.isExecutable) {
                throw new Error("Insufficient signatures to execute transaction");
            }

            const tx = await this.governance.executeTransaction(txHash);
            
            this.monitoring.logTransaction(tx.hash, "EXECUTE_ACTION", {
                governanceHash: txHash
            });

            return tx;
        } catch (error) {
            this.monitoring.logError("EXECUTE_ACTION_FAILED", error);
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
}