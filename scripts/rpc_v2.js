// Probe V2 factory from bitquery docs: 0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e
'use strict';
const https = require('https');
const fs = require('fs');
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const V2_FACTORY = '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e';
const V2_LOCKER = '0x267444d099b10fb5ed7c3cc7b7c767adca574952';
const V2_ROUTER = '0xe33e9e479df8802cb0866d5d05258bec4cf62948';
const PONS = '0x39dBED3a2bd333467115dE45665cC57F813C4571';

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

const out = [];
const log = (s) => { out.push(s); console.log(s); };

(async () => {
  const bn = await rpc('eth_blockNumber', []);
  const latest = Number(bn.result);
  log('latest ' + latest);

  for (const [name, addr] of [['v2factory', V2_FACTORY], ['v2locker', V2_LOCKER], ['v2router', V2_ROUTER]]) {
    const code = await rpc('eth_getCode', [addr, 'latest']);
    log(name + ' codeBytes ' + (code.result ? (code.result.length - 2) / 2 : 0));
    if (code.result && code.result.length > 4) {
      const any = await rpc('eth_getLogs', [{ address: addr, fromBlock: '0x' + (latest - 50000).toString(16), toBlock: bn.result }]);
      if (any.error) { log(name + ' anylogs ERROR ' + JSON.stringify(any.error).slice(0, 150)); continue; }
      log(name + ' anylogs(50k) ' + any.result.length);
      if (any.result.length) {
        const topics = {};
        for (const l of any.result.slice(0, 50)) {
          const t = l.topics[0];
          topics[t] = (topics[t] || 0) + 1;
        }
        log(name + ' topic0 distribution:');
        for (const [t, c] of Object.entries(topics)) log('  ' + t + ' x' + c);
        const first = any.result[0];
        log(name + ' first log: blk ' + Number(first.blockNumber) + ' topics ' + JSON.stringify(first.topics));
      }
    }
  }
  fs.writeFileSync('scripts/rpc_v2_out.txt', out.join('\n'), 'utf8');
  process.exit(0);
})().catch((e) => { fs.writeFileSync('scripts/rpc_v2_out.txt', 'FATAL ' + e.message, 'utf8'); console.log('FATAL', e.message); process.exit(1); });
