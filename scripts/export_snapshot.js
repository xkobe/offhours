// Export the latest snapshot as data/snapshot.json — run by GitHub Actions
// after each index pass; consumed by Vercel functions (R2 public bucket).
'use strict';
const fs = require('fs');
const path = require('path');

const store = require('../lib/store');
const { buildSnapshotFromDb } = require('../lib/snapshot_exporter');

function main() {
  store.init();
  const snap = buildSnapshotFromDb(store.getDb());
  const out = path.join(__dirname, '..', 'data', 'snapshot.json');
  fs.writeFileSync(out, JSON.stringify(snap, (k, v) => (typeof v === 'bigint' ? v.toString() : v)), 'utf8');
  console.log('[export] wrote', out, snap.tokens.length, 'tokens @', snap.generatedAt, '|', snap.market.offHours ? 'off-hours' : 'market hours');
}

main();
