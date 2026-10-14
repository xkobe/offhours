// Snapshot rebuild from SQLite — shared by scripts/export_snapshot.js and
// the local fallback in lib/remote.js. Mirrors the shape of /api/snapshot in
// server.js so the dashboard works unchanged against either source.
'use strict';
const { marketStatus } = require('./data');

function buildSnapshotFromDb(db) {
  const snap = db
    .prepare('SELECT id, generated_at, block, eth_usd, summary_json FROM snapshots ORDER BY generated_at DESC LIMIT 1')
    .get();
  if (!snap) throw new Error('no snapshots in db');

  const tokens = db
    .prepare('SELECT * FROM token_prices WHERE snapshot_id = ? ORDER BY symbol ASC')
    .all(snap.id)
    .map((r) => ({
      symbol: r.symbol,
      name: r.name,
      address: r.address,
      multiplier: r.multiplier,
      type: r.type,
      ref: r.ref_source ? { source: r.ref_source, price: r.ref_price, roundId: r.ref_round_id, updatedAt: r.ref_updated_at } : null,
      dex: r.dex_price !== null ? { price: r.dex_price, pool: r.dex_pool, fee: r.dex_fee, quote: r.dex_quote, tvl: r.dex_tvl } : null,
      premium: r.premium === null ? null : Number(r.premium),
      tvl: r.tvl,
      offHours: !!r.off_hours,
    }));

  let summary = {};
  try { summary = JSON.parse(snap.summary_json || '{}'); } catch { /* keep empty */ }

  return {
    generatedAt: snap.generated_at,
    chain: {
      id: 4663,
      name: 'Robinhood Chain',
      block: snap.block ? Number(snap.block) : null,
      rpc: process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
    },
    market: marketStatus(),
    ethUsd: snap.eth_usd,
    ethPoolEvidence: null,
    summary,
    tokens,
  };
}

module.exports = { buildSnapshotFromDb };
