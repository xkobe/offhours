// GET /api/token-info?symbol=NVDA — on-chain ERC-20 metadata (live RPC call).
'use strict';
const remote = require('../lib/remote');
const { json, parseQuery } = require('../lib/fn');

const erc20InfoAbi = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

module.exports = async function handler(req, res) {
  try {
    const { q } = parseQuery(req.url);
    const sym = (q.get('symbol') || '').trim().toUpperCase();
    if (!sym) { json(res, 400, { error: 'symbol required' }); return; }

    const snap = await remote.getSnapshot();
    const t = (snap.tokens || []).find((x) => x.symbol === sym);
    if (!t) { json(res, 404, { error: 'unknown symbol' }); return; }

    const hc = require('hoodchain');
    const client = hc.createHoodClient({ rpcUrl: process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com' });
    const [nm, sm, dc, ts] = await client.public.multicall({
      contracts: ['name', 'symbol', 'decimals', 'totalSupply'].map((fn) => ({ address: t.address, abi: erc20InfoAbi, functionName: fn })),
      allowFailure: true,
    });
    const ok = (r) => r && r.status === 'success' && r.result !== undefined && r.result !== null;
    const decimals = ok(dc) ? Number(dc.result) : 18;
    const totalSupply = ok(ts) ? ts.result.toString() : null;
    json(res, 200, {
      symbol: t.symbol, address: t.address, multiplier: t.multiplier,
      name: ok(nm) ? nm.result : t.name,
      onChainSymbol: ok(sm) ? sm.result : null,
      decimals,
      totalSupply,
      totalSupplyHuman: totalSupply !== null ? (Number(totalSupply) / 10 ** decimals).toLocaleString('en-US', { maximumFractionDigits: 4 }) : null,
    });
  } catch (e) {
    json(res, 502, { error: e.message });
  }
};
