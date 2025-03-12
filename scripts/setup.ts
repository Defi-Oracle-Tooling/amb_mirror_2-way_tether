import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function setupEnvironment() {
    // Create .env file with default configuration
    const envContent = `# Network RPC URLs
ETH_RPC_URL=
POLYGON_RPC_URL=
ARBITRUM_RPC_URL=
OPTIMISM_RPC_URL=
GOERLI_RPC_URL=
MUMBAI_RPC_URL=

# Explorer API Keys
ETHERSCAN_API_KEY=
POLYGONSCAN_API_KEY=
ARBISCAN_API_KEY=
OPTIMISTIC_ETHERSCAN_API_KEY=

# Development Accounts
TESTNET_ADMINS=
TESTNET_OPERATORS=
TESTNET_GUARDIANS=
MAINNET_ADMINS=
MAINNET_OPERATORS=
MAINNET_GUARDIANS=

# Alert Endpoints
SLACK_WEBHOOK_URL=
EMAIL_WEBHOOK_URL=

# Development Settings
DEPLOY_ENV=local
HARDHAT_NETWORK=localhost
`;

    if (!fs.existsSync('.env')) {
        fs.writeFileSync('.env', envContent);
        console.log('Created .env file with default configuration');
    }

    // Create deployments directory structure
    const environments = ['local', 'testnet', 'mainnet'];
    environments.forEach(env => {
        const dir = path.join('deployments', env);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`Created deployments directory for ${env} environment`);
        }
    });

    // Compile contracts
    try {
        console.log('Compiling contracts...');
        execSync('npx hardhat compile', { stdio: 'inherit' });
    } catch (error) {
        console.error('Error compiling contracts:', error);
        process.exit(1);
    }

    // Run tests
    try {
        console.log('Running tests...');
        execSync('npx hardhat test', { stdio: 'inherit' });
    } catch (error) {
        console.error('Error running tests:', error);
        process.exit(1);
    }

    console.log(`
Development environment setup complete!

Next steps:
1. Configure your .env file with appropriate values
2. Start local development with: npx hardhat node
3. Deploy to local network with: DEPLOY_ENV=local npx hardhat run scripts/deploy/deploy.ts
4. Run integration tests with: npx hardhat test test/integration/*

For deployment to other networks:
- Testnet: DEPLOY_ENV=testnet npx hardhat run scripts/deploy/deploy.ts --network goerli
- Mainnet: DEPLOY_ENV=mainnet npx hardhat run scripts/deploy/deploy.ts --network ethereum
    `);
}

setupEnvironment();