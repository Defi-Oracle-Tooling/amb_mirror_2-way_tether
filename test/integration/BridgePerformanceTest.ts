import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract, ContractRunner, Log } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MonitoringService } from "../../src/utils/MonitoringService";
import { BridgeService } from "../../src/services/BridgeService";
import { IBridgeMirror, IBridgeGovernance } from "../../typechain-types";

describe("Bridge Performance Tests", function () {
    // Increase timeout for performance tests
    this.timeout(60000);

    let sourceChainBridge: IBridgeMirror;
    let targetChainBridge: IBridgeMirror;
    let sourceChainGovernance: IBridgeGovernance;
    let targetChainGovernance: IBridgeGovernance;
    let owner: HardhatEthersSigner;
    let operators: HardhatEthersSigner[];
    let admins: HardhatEthersSigner[];
    let testToken: Contract;
    let monitoringService: MonitoringService;

    before(async function () {
        [owner, ...operators] = await ethers.getSigners();
        admins = operators.slice(0, 2);
        operators = operators.slice(2, 4);

        // Setup monitoring
        monitoringService = new MonitoringService({
            alertThresholds: {
                transactionDelay: 5000,
                signatureDelay: 3000,
                errorRate: 3,
                blockConfirmations: 1,
                crossChainLatency: 10000
            },
            healthCheckInterval: 1000
        });

        // Deploy test token
        const TestToken = await ethers.getContractFactory("MyERC20Token");
        testToken = await TestToken.deploy("Performance Test Token", "PTT");
        await testToken.waitForDeployment();

        // Deploy contracts for source chain
        const BridgeGovernance = await ethers.getContractFactory("BridgeGovernance");
        sourceChainGovernance = await BridgeGovernance.deploy() as IBridgeGovernance;
        await sourceChainGovernance.waitForDeployment();

        const BridgeMirror = await ethers.getContractFactory("BridgeMirror");
        sourceChainBridge = await BridgeMirror.deploy(await sourceChainGovernance.getAddress()) as IBridgeMirror;
        await sourceChainBridge.waitForDeployment();

        // Deploy contracts for target chain
        targetChainGovernance = await BridgeGovernance.deploy() as IBridgeGovernance;
        await targetChainGovernance.waitForDeployment();

        targetChainBridge = await BridgeMirror.deploy(await targetChainGovernance.getAddress()) as IBridgeMirror;
        await targetChainBridge.waitForDeployment();

        // Setup roles and configuration
        await setupChainRoles(sourceChainGovernance);
        await setupChainRoles(targetChainGovernance);

        // Enable features and register token
        await enableFeature(sourceChainBridge, sourceChainGovernance, "TOKEN_LOCK", admins);
        await enableFeature(targetChainBridge, targetChainGovernance, "TOKEN_LOCK", admins);
        await sourceChainBridge.connect(operators[0]).registerToken(testToken.getAddress());
        await targetChainBridge.connect(operators[0]).registerToken(testToken.getAddress());
    });

    async function setupChainRoles(governance: IBridgeGovernance) {
        const ADMIN_ROLE = 2;
        const OPERATOR_ROLE = 1;

        for (const admin of admins) {
            await governance.assignRole(admin.address, ADMIN_ROLE);
        }
        for (const operator of operators) {
            await governance.assignRole(operator.address, OPERATOR_ROLE);
        }
        await governance.updateThreshold(2);
    }

    async function enableFeature(
        bridge: IBridgeMirror,
        governance: IBridgeGovernance,
        feature: string,
        admins: HardhatEthersSigner[]
    ) {
        const toggleData = bridge.interface.encodeFunctionData("toggleFeature", [feature, true]);
        const tx = await governance.connect(admins[0]).proposeTransaction(
            await bridge.getAddress(),
            0n,
            toggleData
        );
        const receipt = await tx.wait();
        const txHash = receipt!.logs[0].topics[1];

        for (const admin of admins) {
            await governance.connect(admin).signTransaction(txHash);
        }
        await governance.connect(admins[0]).executeTransaction(txHash);
    }

    describe("Concurrent Transaction Processing", function () {
        it("Should handle multiple concurrent token locks", async function () {
            const amount = ethers.parseEther("1");
            const targetChainId = 2;
            const numTransactions = 10;
            const startTime = Date.now();

            // Mint tokens for testing
            await testToken.mint(operators[0].address, amount * BigInt(numTransactions));
            await testToken.connect(operators[0]).approve(
                sourceChainBridge.getAddress(),
                amount * BigInt(numTransactions)
            );

            // Submit transactions concurrently
            const promises = Array(numTransactions).fill(0).map(() =>
                sourceChainBridge.connect(operators[0]).lockTokens(
                    testToken.getAddress(),
                    amount,
                    targetChainId,
                    operators[0].address
                )
            );

            const results = await Promise.all(promises);
            const receipts = await Promise.all(results.map(tx => tx.wait()));

            const endTime = Date.now();
            const duration = endTime - startTime;
            const tps = numTransactions / (duration / 1000);

            console.log(`Processed ${numTransactions} transactions in ${duration}ms (${tps.toFixed(2)} TPS)`);
            expect(receipts).to.have.length(numTransactions);
        });

        it("Should maintain data consistency under load", async function () {
            const batchSize = 5;
            const numBatches = 4;
            const amount = ethers.parseEther("1");
            const targetChainId = 2;

            for (let batch = 0; batch < numBatches; batch++) {
                // Setup batch of transactions
                const batchPromises = Array(batchSize).fill(0).map(async () => {
                    // Mint new tokens for each transaction
                    await testToken.mint(operators[0].address, amount);
                    await testToken.connect(operators[0]).approve(sourceChainBridge.getAddress(), amount);

                    // Lock tokens
                    const lockTx = await sourceChainBridge.connect(operators[0]).lockTokens(
                        testToken.getAddress(),
                        amount,
                        targetChainId,
                        operators[0].address
                    );
                    const receipt = await lockTx.wait();

                    // Find lock event
                    const lockEvent = receipt?.logs.find((e: Log) => {
                        try {
                            const decoded = sourceChainBridge.interface.parseLog(e as any);
                            return decoded?.name === "TokensLocked";
                        } catch {
                            return false;
                        }
                    });

                    expect(lockEvent).to.not.be.undefined;
                    const decodedEvent = sourceChainBridge.interface.parseLog(lockEvent as any);

                    // Verify lock was successful
                    return {
                        amount,
                        lockId: decodedEvent.args.lockId
                    };
                });

                const batchResults = await Promise.all(batchPromises);

                // Verify all locks in batch
                for (const result of batchResults) {
                    const lockedAmount = await sourceChainBridge.getLockedAmount(
                        testToken.getAddress(),
                        result.lockId
                    );
                    expect(lockedAmount).to.equal(result.amount);
                }
            }
        });

        it("Should handle rapid governance actions", async function () {
            const numFeatures = 5;
            const features = Array(numFeatures).fill(0).map((_, i) => `TEST_FEATURE_${i}`);
            
            // Enable features rapidly
            const enablePromises = features.map(feature => 
                enableFeature(sourceChainBridge, sourceChainGovernance, feature, admins)
            );
            await Promise.all(enablePromises);

            // Verify all features were enabled correctly
            for (const feature of features) {
                expect(await sourceChainBridge.isFeatureEnabled(feature)).to.be.true;
            }

            // Disable features rapidly
            const disablePromises = features.map(async feature => {
                const toggleData = sourceChainBridge.interface.encodeFunctionData(
                    "toggleFeature",
                    [feature, false]
                );
                const tx = await sourceChainGovernance.connect(admins[0]).proposeTransaction(
                    await sourceChainBridge.getAddress(),
                    0n,
                    toggleData
                );
                const receipt = await tx.wait();
                const txHash = receipt!.logs[0].topics[1];

                for (const admin of admins) {
                    await sourceChainGovernance.connect(admin).signTransaction(txHash);
                }
                return sourceChainGovernance.connect(admins[0]).executeTransaction(txHash);
            });
            await Promise.all(disablePromises);

            // Verify all features were disabled correctly
            for (const feature of features) {
                expect(await sourceChainBridge.isFeatureEnabled(feature)).to.be.false;
            }
        });
    });

    describe("Resource Usage", function () {
        it("Should efficiently handle large token transfers", async function () {
            const largeAmount = ethers.parseEther("1000000");
            const targetChainId = 2;
            
            await testToken.mint(operators[0].address, largeAmount);
            await testToken.connect(operators[0]).approve(sourceChainBridge.getAddress(), largeAmount);

            const tx = await sourceChainBridge.connect(operators[0]).lockTokens(
                testToken.getAddress(),
                largeAmount,
                targetChainId,
                operators[0].address
            );
            const receipt = await tx.wait();

            // Check gas usage is reasonable
            expect(receipt?.gasUsed).to.be.below(300000); // Adjust threshold as needed
        });

        it("Should handle sustained transaction load", async function () {
            const amount = ethers.parseEther("1");
            const targetChainId = 2;
            const batchSize = 5;
            const numBatches = 3;
            const delayBetweenBatches = 1000; // 1 second

            for (let i = 0; i < numBatches; i++) {
                // Process batch
                const batchPromises = Array(batchSize).fill(0).map(async () => {
                    await testToken.mint(operators[0].address, amount);
                    await testToken.connect(operators[0]).approve(sourceChainBridge.getAddress(), amount);
                    return sourceChainBridge.connect(operators[0]).lockTokens(
                        testToken.getAddress(),
                        amount,
                        targetChainId,
                        operators[0].address
                    );
                });

                const results = await Promise.all(batchPromises);
                await Promise.all(results.map(tx => tx.wait()));

                if (i < numBatches - 1) {
                    await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
                }
            }

            // Verify system state after load
            const totalLocked = await testToken.balanceOf(sourceChainBridge.getAddress());
            expect(totalLocked).to.equal(amount * BigInt(batchSize * numBatches));
        });
    });
});