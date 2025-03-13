import { ethers } from "ethers";
import { MonitoringService } from "../utils/MonitoringService";

interface TransactionEvent extends Omit<ethers.Event, 'args'> {
    args: ethers.utils.Result & {
        transactionHash: string;
    };
}

export class BridgeService {
    private provider: ethers.providers.Provider;
    private bridgeAddress: string;
    private governanceAddress: string;
    private bridgeInterface: ethers.utils.Interface;
    private governanceInterface: ethers.utils.Interface;
    private monitoringService: MonitoringService;

    constructor(
        provider: ethers.providers.Provider,
        bridgeAddress: string,
        governanceAddress: string,
        bridgeInterface: ethers.utils.Interface,
        governanceInterface: ethers.utils.Interface,
        monitoringService: MonitoringService
    ) {
        this.provider = provider;
        this.bridgeAddress = bridgeAddress;
        this.governanceAddress = governanceAddress;
        this.bridgeInterface = bridgeInterface;
        this.governanceInterface = governanceInterface;
        this.monitoringService = monitoringService;
    }

    async proposeTransaction(
        targetAddress: string,
        targetChainId: number,
        data: string
    ): Promise<string> {
        const bridge = new ethers.Contract(this.bridgeAddress, this.bridgeInterface, this.provider);
        const tx = await bridge.proposeTransaction(targetAddress, targetChainId, data);
        const receipt = await tx.wait();
        
        // Get transaction hash from events
        const event = receipt.events?.find((e: TransactionEvent) => e.event === "TransactionProposed");
        const txHash = event?.args.transactionHash;

        if (txHash) {
            // Start monitoring this transaction
            this.monitoringService.trackTransaction(
                txHash,
                await this.provider.getNetwork().then((n: ethers.providers.Network) => n.chainId),
                targetChainId
            );
        }

        return txHash;
    }

    async signTransaction(txHash: string): Promise<void> {
        const governance = new ethers.Contract(
            this.governanceAddress,
            this.governanceInterface,
            this.provider
        );
        
        const tx = await governance.signTransaction(txHash);
        await tx.wait();
    }

    async executeTransaction(txHash: string): Promise<void> {
        const bridge = new ethers.Contract(
            this.bridgeAddress,
            this.bridgeInterface,
            this.provider
        );

        try {
            const tx = await bridge.executeTransaction(txHash);
            await tx.wait();
            this.monitoringService.confirmTransaction(txHash, true);
        } catch (error) {
            this.monitoringService.confirmTransaction(txHash, false);
            throw error;
        }
    }

    async toggleFeature(featureName: string, enabled: boolean): Promise<void> {
        const governance = new ethers.Contract(
            this.governanceAddress,
            this.governanceInterface,
            this.provider
        );

        const tx = await governance.toggleFeature(featureName, enabled);
        await tx.wait();
    }
}