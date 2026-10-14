// Probe: can we read Pons launch + graduation data from Robinhood Chain RPC?
'use strict';
const hc = require('hoodchain');
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const client = hc.createHoodClient({ rpcUrl: RPC });

const ACTIVE_FACTORY = '0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB'; // start block 8991118
const LEGACY_FACTORY = '0x0c37a24F5D23A486FA692d1500881d698B1F77a4';  // start block 8600612
const REF_PONS = '0x39dBED3a2bd333467115dE45665cC57F813C4571';

const TOKEN_LAUNCHED = '0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getLogsChunked(factory, fromBlock, toBlock, chunkSize = 20000) {
  const logs = [];
  let from = fromBlock;
  while (from <= toBlock) {
    const to = Math.min(from + chunkSize - 1, toBlock);
    try {
      const part = await client.public.getLogs({
        address: factory,
        fromBlock: from,
        toBlock: to,
        topics: [TOKEN_LAUNCHED],
      });
      logs.push(...part);
    } catch (e) {
      console.log('chunk fail', from, '-', to, e.message.slice(0, 120));
      await sleep(1500);
      continue; // retry same chunk
    }
    from = to + 1;
  }
  return logs;
}

(async () => {
  // 1. latest block
  const latest = Number(await client.public.getBlockNumber());
  console.log('latest block', latest);

  // 2. count launches on active factory (recent window first: last 100k blocks)
  const from = Math.max(8991118, latest - 100000);
  const logs = await getLogsChunked(ACTIVE_FACTORY, from, latest);
  console.log('active factory launches (last ~100k blocks):', logs.length);
  if (logs.length > 0) {
    console.log('sample log keys:', Object.keys(logs[0]).join(','));
    const l = logs[0];
    console.log('sample args:', JSON.stringify({ token: l.args.token, deployer: l.args.deployer, pool: l.args.pool, block: Number(l.blockNumber) }).slice(0, 300));
  }

  // 3. graduationStatus on a few launched tokens + PONS ref
  const addresses = [...new Set(logs.map((l) => l.args.token)).values()].slice(0, 5);
  addresses.push(REF_PONS);
  const gradAbi = [{ type: 'function', name: 'graduationStatus', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'bool' }] }];
  const res = await client.public.multicall({
    contracts: addresses.map((a) => ({ address: ACTIVE_FACTORY, abi: gradAbi, functionName: 'graduationStatus', args: [a] })),
    allowFailure: true,
  });
  addresses.forEach((a, i) => {
    const r = res[i];
    console.log('grad', a.slice(0, 8), r.status === 'success' ? JSON.stringify({ paired: (r.result[0] / 1e18).toFixed(4) + ' ETH', threshold: (r.result[1] / 1e18).toFixed(4) + ' ETH', graduated: r.result[2] }) : 'FAIL ' + (r.error || ''));
  });
  process.exit(0);
})();
