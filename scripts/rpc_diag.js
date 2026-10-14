// Minimal raw JSON-RPC diagnostic for eth_getLogs on Robinhood Chain
'use strict';
const https = require('https');
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const FACTORY = '0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB';
const TOPIC = '0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a';

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const req = https.request(RPC, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('bad json ' + data.slice(0, 120))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

(async () => {
  // 1. block number
  const bn = await rpc('eth_blockNumber', []);
  console.log('blockNumber', bn.result, Number(bn.result));

  // 2. try eth_getLogs with small range around current head
  const latest = Number(bn.result);
  const tests = [
    { label: 'head-5000..head', from: '0x' + (latest - 5000).toString(16), to: bn.result },
    { label: 'factory start..start+2000', from: '0x' + 8991118 .toString(16), to: '0x' + (8991118 + 2000).toString(16) },
  ];
  for (const t of tests) {
    const p = await rpc('eth_getLogs', [{ address: FACTORY, topics: [TOPIC], fromBlock: t.from, toBlock: t.to }]);
    if (p.error) {
      console.log(t.label, 'ERROR', JSON.stringify(p.error).slice(0, 200));
    } else {
      console.log(t.label, 'logs', p.result.length);
      if (p.result.length) {
        const l = p.result[0];
        console.log('  first:', l.address, 'blk', Number(l.blockNumber), 'topics', l.topics.length, 'data', l.data.length, 'bytes');
      }
    }
  }

  // 3. graduationStatus via eth_call on PONS ref token through factory
  // graduationStatus(address) selector: keccak("graduationStatus(address)")[0..8]
  // compute manually: we use known selector
  const sel = '0x2f53ef2f'; // from bitquery doc: createGraduatedPool — not graduationStatus. Compute below.
  // graduationStatus(address) -> selector = 0x??????; compute with keccak not available; instead use multicall via eth_call with raw calldata guess is wrong. Try eth_call with known ABI via viem later. Skip here.
  console.log('selector note: graduationStatus selector to be resolved via viem in lib');
  process.exit(0);
})();
