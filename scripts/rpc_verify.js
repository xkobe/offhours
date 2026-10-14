// Verify factory contract existence + activity + graduationStatus call
'use strict';
const https = require('https');
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

(async () => {
  const bn = await rpc('eth_blockNumber', []);
  const latest = Number(bn.result);
  console.log('latest', latest);

  for (const [name, addr] of [['active', FACTORY], ['legacy', LEGACY]]) {
    const code = await rpc('eth_getCode', [addr, 'latest']);
    console.log(name, 'factory', addr, 'codeLen', code.result ? code.result.length / 2 - 1 : 0);
  }

  // any events on active factory in last 2000 blocks (no topic filter)
  const any = await rpc('eth_getLogs', [{ address: FACTORY, fromBlock: '0x' + (latest - 2000).toString(16), toBlock: bn.result }]);
  console.log('active factory any-event logs (last 2000 blk):', any.error ? JSON.stringify(any.error).slice(0,150) : any.result.length);

  // graduationStatus selector via viem is easier in node: require viem's encodeFunctionData
  try {
    const { encodeFunctionData } = require('viem');
    const calldata = encodeFunctionData({ abi: [{ type: 'function', name: 'graduationStatus', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'bool' }] }], functionName: 'graduationStatus', args: [PONS] });
    console.log('grad calldata', calldata.slice(0, 10));
    const call = await rpc('eth_call', [{ to: FACTORY, data: calldata }, 'latest']);
    if (call.error) console.log('grad call ERROR', JSON.stringify(call.error).slice(0, 200));
    else console.log('grad call result raw', call.result, '| paired ETH', (BigInt('0x' + call.result.slice(2, 66)) / 10n ** 18n).toString(), '| threshold ETH', (BigInt('0x' + call.result.slice(66, 130)) / 10n ** 18n).toString(), '| graduated', call.result.slice(130) !== '00'.repeat(31) + '00');
  } catch (e) {
    console.log('viem helper fail', e.message.slice(0, 120));
  }
  process.exit(0);
})();
