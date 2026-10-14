// GET /api/evidence?hash=<64hex> — recompute CID fingerprint + on-chain anchor lookup.
'use strict';
const { json, parseQuery } = require('../lib/fn');
const { cidV0FromSha256, verifyHash } = require('../lib/verify');

async function evidenceLookup(hash) {
  const registry = process.env.ANCHOR_REGISTRY_ADDRESS;
  if (!registry) return { status: 'not_configured', note: 'ANCHOR_REGISTRY_ADDRESS not configured (deploy AnchorRegistry then set it)' };
  const fs = require('fs');
  const path = require('path');
  const artifactPath = path.join(__dirname, '..', 'build', 'AnchorRegistry.json');
  if (!fs.existsSync(artifactPath)) return { status: 'not_configured', note: 'build/AnchorRegistry.json missing (run node scripts/compile_anchor.js)' };
  const { abi } = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const hc = require('hoodchain');
  const client = hc.createHoodClient({ rpcUrl: process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com' });
  try {
    const rec = await client.public.readContract({ address: registry, abi, functionName: 'getAnchor', args: ['0x' + hash] });
    const chainRecord = { cid: rec[0], timestamp: Number(rec[1]), anchoredBy: rec[2] };
    return { status: 'verified', ...verifyHash(hash, chainRecord), chainRecord };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
}

module.exports = async function handler(req, res) {
  try {
    const { q } = parseQuery(req.url);
    const hash = (q.get('hash') || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) { json(res, 400, { error: 'hash must be 64 hex chars' }); return; }
    const localCid = cidV0FromSha256(hash);
    const lookup = await evidenceLookup(hash);
    json(res, 200, { hash, localCid, ...lookup });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
};
