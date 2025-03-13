import { ethers } from "hardhat";
import { expect } from "chai";
import { BridgeError, BridgeErrorType } from "../../src/utils/BridgeErrors";
import { MonitoringService, AlertLevel } from "../../src/utils/MonitoringService";
import { BridgeService } from "../../src/services/BridgeService";

describe("Bridge Error Handling", function () {
    let monitoringService: MonitoringService;
    let bridgeService: BridgeService;
    let bridge: any;
    let governance: any;
    let owner: any;
    let alertsReceived: any[];

    beforeEach(async function () {
        const [signer] = await ethers.getSigners();
        owner = signer;

        // Deploy test contracts
        const BridgeMirror = await ethers.getContractFactory("BridgeMirror");
        const BridgeGovernance = await ethers.getContractFactory("BridgeGovernance");
        
        governance = await BridgeGovernance.deploy();
        await governance.waitForDeployment();
        
        bridge = await BridgeMirror.deploy(await governance.getAddress());
        await bridge.waitForDeployment();

        // Setup monitoring
        alertsReceived = [];
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

        monitoringService.on('alert', (alert) => alertsReceived.push(alert));
        monitoringService.addNetwork(1, ethers.provider);

        // Setup bridge service
        bridgeService = new BridgeService(
            ethers.provider,
            await bridge.getAddress(),
            await governance.getAddress(),
            bridge.interface,
            governance.interface,
            monitoringService
        );
    });

    describe("Contract Error Handling", function () {
        it("Should handle unauthorized access errors", async function () {
            // Try to toggle feature without proper role
            await expect(
                bridgeService.toggleFeature("TEST_FEATURE", true)
            ).to.be.rejectedWith(BridgeError);

            const error = alertsReceived.find(
                alert => alert.level === AlertLevel.ERROR &&
                alert.error instanceof BridgeError &&
                alert.error.type === BridgeErrorType.Unauthorized
            );

            expect(error).to.not.be.undefined;
            expect(error!.error).to.be.instanceOf(BridgeError);
        });

        it("Should handle feature management errors", async function () {
            // Try to enable already enabled feature
            await governance.assignRole(owner.address, 2); // ADMIN_ROLE
            await bridgeService.toggleFeature("TEST_FEATURE", true);
            
            await expect(
                bridgeService.toggleFeature("TEST_FEATURE", true)
            ).to.be.rejectedWith(BridgeError);

            const error = alertsReceived.find(
                alert => alert.level === AlertLevel.ERROR &&
                alert.error instanceof BridgeError &&
                alert.error.type === BridgeErrorType.FeatureAlreadyEnabled
            );

            expect(error).to.not.be.undefined;
        });

        it("Should handle invalid parameter errors", async function () {
            await expect(
                bridgeService.proposeTransaction(
                    ethers.ZeroAddress,
                    0n,
                    "0x"
                )
            ).to.be.rejectedWith(BridgeError);

            const error = alertsReceived.find(
                alert => alert.level === AlertLevel.ERROR &&
                alert.error instanceof BridgeError &&
                alert.error.type === BridgeErrorType.InvalidDestination
            );

            expect(error).to.not.be.undefined;
        });
    });

    describe("Network Error Handling", function () {
        it("Should handle network timeouts", async function () {
            // Create a provider that always times out
            const timeoutProvider = new ethers.JsonRpcProvider("http://invalid-url:8545");
            const serviceWithTimeout = new BridgeService(
                timeoutProvider,
                await bridge.getAddress(),
                await governance.getAddress(),
                bridge.interface,
                governance.interface,
                monitoringService
            );

            await expect(
                serviceWithTimeout.toggleFeature("TEST_FEATURE", true)
            ).to.be.rejectedWith(BridgeError);

            const error = alertsReceived.find(
                alert => alert.level === AlertLevel.ERROR &&
                alert.error instanceof BridgeError &&
                alert.error.type === BridgeErrorType.ContractCallFailed
            );

            expect(error).to.not.be.undefined;
            expect(error!.error!.details).to.have.property('originalError');
        });
    });

    describe("Error Context and Details", function () {
        it("Should include relevant context in errors", async function () {
            const feature = "TEST_FEATURE";
            try {
                await bridgeService.toggleFeature(feature, true);
                expect.fail("Should have thrown error");
            } catch (error) {
                expect(error).to.be.instanceOf(BridgeError);
                const bridgeError = error as BridgeError;
                expect(bridgeError.details).to.include({
                    operation: 'toggleFeature',
                    feature: feature,
                    enabled: true
                });
            }
        });

        it("Should properly format error messages", async function () {
            try {
                await bridgeService.proposeTransaction(
                    ethers.ZeroAddress,
                    0n,
                    "0x"
                );
                expect.fail("Should have thrown error");
            } catch (error) {
                expect(error).to.be.instanceOf(BridgeError);
                const bridgeError = error as BridgeError;
                expect(bridgeError.message).to.be.a('string');
                expect(bridgeError.message).to.not.be.empty;
            }
        });
    });

    describe("Error Recovery and Monitoring", function () {
        it("Should track error rates correctly", async function () {
            // Cause multiple errors
            for (let i = 0; i < 3; i++) {
                try {
                    await bridgeService.toggleFeature("TEST_FEATURE", true);
                } catch (error) {
                    // Expected error
                }
            }

            const metrics = monitoringService.getMetrics(1);
            expect(metrics).to.have.property('errorRate');
            expect(metrics.errorRate).to.be.greaterThan(0);

            const criticalAlert = alertsReceived.find(
                alert => alert.level === AlertLevel.CRITICAL
            );
            expect(criticalAlert).to.not.be.undefined;
        });

        it("Should provide meaningful stack traces", async function () {
            try {
                await bridgeService.toggleFeature("TEST_FEATURE", true);
                expect.fail("Should have thrown error");
            } catch (error) {
                expect(error).to.be.instanceOf(BridgeError);
                const bridgeError = error as BridgeError;
                expect(bridgeError.stack).to.be.a('string');
                expect(bridgeError.stack).to.include('BridgeService');
            }
        });
    });
});