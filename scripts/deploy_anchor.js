// Deploy AnchorRegistry to Robinhood Chain (mainnet 4663 or testnet 46630) with viem.
// Env: DEPLOYER_PRIVATE_KEY (required), RPC_URL (optional), CHAIN_ID (optional, default 46630)
// Usage: node scripts/deploy_anchor.js                -> testnet (46630)
//        node scripts/deploy_anchor.js --chain=4663   -> mainnet
const fs = require('fs');
const path = require('path');
const { createWalletClient, createPublicClient, http, defineChain } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');

const ARTIFACT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'AnchorRegistry.json'), 'utf8'));

const argChain = process.argv.find((a) => a.startsWith('--chain='));
const CHAIN_ID = parseInt(argChain ? argChain.split('=')[1] : (process.env.CHAIN_ID || '46630'), 10);
const MAINNET_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const TESTNET_RPC = 'https://rpc.testnet.chain.robinhood.com';
const RPC = process.env.RPC_URL || (CHAIN_ID === 4663 ? MAINNET_RPC : TESTNET_RPC);
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('[deploy] missing DEPLOYER_PRIVATE_KEY env (deployer wallet private key)');
  process.exit(1);
}

const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 4663 ? 'Robinhood Chain' : 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

async function main() {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const wallet = createWalletClient({ account, chain, transport: http(RPC) });
  const publicClient = createPublicClient({ chain, transport: http(RPC) });

  console.log('[deploy] chain', CHAIN_ID, '| rpc', RPC, '| deployer', account.address);
  const hash = await wallet.deployContract({ abi: ARTIFACT.abi, bytecode: ARTIFACT.bytecode });
  console.log('[deploy] tx', hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('[deploy] contract address', receipt.contractAddress);
  if (!receipt.contractAddress) {
    console.error('[deploy] no contract address in receipt (tx reverted?)');
    process.exit(1);
  }
}

main().catch((e) => { console.error('[deploy] failed:', e.message); process.exit(1); });
