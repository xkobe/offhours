// Full verify, writes results to file
'use strict';
const https = require('https');
const fs = require('fs');
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const FACTORY = '0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB';
const LEGACY = '0x0c37a24F5D23A486FA692d1500881d698B1F77a4';
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

  for (const [name, addr] of [['active', FACTORY], ['legacy', LEGACY]]) {
    const code = await rpc('eth_getCode', [addr, 'latest']);
    const len = code.result ? (code.result.length - 2) / 2 : 0;
    log(name + ' factory codeBytes ' + len);
    const any = await rpc('eth_getLogs', [{ address: addr, fromBlock: '0x' + (latest - 50000).toString(16), toBlock: bn.result }]);
    log(name + ' anylogs(50k blk) ' + (any.error ? JSON.stringify(any.error).slice(0, 120) : any.result.length));
  }

  // graduationStatus on PONS through active factory
  try {
    const { encodeFunctionData } = require('viem');
    const calldata = encodeFunctionData({
      abi: [{ type: 'function', name: 'graduationStatus', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'bool' }] }],
      functionName: 'graduationStatus', args: [PONS],
    });
    log('grad selector ' + calldata.slice(0, 10));
    const call = await rpc('eth_call', [{ to: FACTORY, data: calldata }, 'latest']);
    if (call.error) log('grad ERROR ' + JSON.stringify(call.error).slice(0, 200));
    else {
      const hex = call.result;
      const paired = BigInt('0x' + hex.slice(2, 66)) / 10n ** 18n;
      const thr = BigInt('0x' + hex.slice(66, 130)) / 10n ** 18n;
      log('grad paired ' + paired.toString() + ' ETH threshold ' + thr.toString() + ' ETH graduated ' + (hex.slice(130, 132) === '01' ? true : false));
    }
  } catch (e) {
    log('viem fail ' + e.message.slice(0, 150));
  }
  fs.writeFileSync('scripts/rpc_verify_out.txt', out.join('\n'), 'utf8');
  process.exit(0);
})().catch((e) => { fs.writeFileSync('scripts/rpc_verify_out.txt', 'FATAL ' + e.message, 'utf8'); console.log('FATAL', e.message); process.exit(1); });
