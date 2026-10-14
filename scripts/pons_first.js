// Find earliest TokenLaunched block on V2 factory (binary search)
'use strict';
const https = require('https');
const fs = require('fs');
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const FACTORY = '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e';
const TL = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607';

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const req = https.request(RPC, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('bad json')); } });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.write(body); req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function logsAt(factory, from, to) {
  for (let i = 0; i < 4; i++) {
    const r = await rpc('eth_getLogs', [{ address: factory, topics: [TL], fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }]);
    if (r.error) { await sleep(1200); continue; }
    return r.result.length;
  }
  return -1; // error
}

(async () => {
  const bn = await rpc('eth_blockNumber', []);
  const latest = Number(bn.result);
  const out = [];

  // binary search first block with a TokenLaunched log
  let lo = 1, hi = latest, first = null;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const n = await logsAt(FACTORY, mid, hi);
    out.push('probe ' + mid + '-' + hi + ' -> ' + n);
    if (n <= 0) { lo = mid + 1; } else { hi = mid; }
    if (n === -1) { out.push('probe ERROR at ' + mid + '-' + hi); break; }
    // narrow: if there are logs in [mid, hi], search lower half [lo, mid]
    if (n > 0) { hi = mid; } else { lo = mid + 1; }
  }
  first = lo;
  out.push('FIRST_TOKEN_LAUNCHED_BLOCK ' + first);

  // sanity: count logs from first..first+500
  const c = await logsAt(FACTORY, first, first + 500);
  out.push('count in first 500 blocks after first: ' + c);

  fs.writeFileSync('scripts/pons_first_out.txt', out.join('\n'), 'utf8');
  console.log('done, see scripts/pons_first_out.txt');
  process.exit(0);
})().catch((e) => { fs.writeFileSync('scripts/pons_first_out.txt', 'FATAL ' + e.message, 'utf8'); process.exit(1); });
