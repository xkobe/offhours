// Probe USDG token metadata on Robinhood Chain for EIP-712 domain (EIP-3009 signing).
'use strict';
const fs = require('fs');
const path = require('path');
const { createPublicClient, http } = require('viem');

const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const rpc = process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';

const erc20 = [
  { name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'version', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { name: 'eip712Domain', type: 'function', stateMutability: 'view', inputs: [], outputs: [
    { type: 'bytes1' }, { type: 'string' }, { type: 'string' }, { type: 'uint256' }, { type: 'address' },
    { type: 'bytes32' }, { type: 'uint256[]' },
  ] },
];

(async () => {
  const client = createPublicClient({ transport: http(rpc) });
  const out = [];
  for (const fn of erc20) {
    try {
      const v = await client.readContract({ address: USDG, abi: [fn], functionName: fn.name, args: [] });
      out.push(fn.name + ': ' + (typeof v === 'object' ? JSON.stringify(v) : String(v)));
    } catch (e) {
      out.push(fn.name + ': REVERT/ERR ' + String(e.shortMessage || e.message || e).slice(0, 100));
    }
  }
  fs.writeFileSync(path.join(__dirname, 'usdg_probe_out.txt'), out.join('\n'), 'utf8');
  process.exit(0);
})().catch((e) => {
  fs.writeFileSync(path.join(__dirname, 'usdg_probe_out.txt'), 'FATAL ' + String(e && e.stack || e), 'utf8');
  process.exit(1);
});
