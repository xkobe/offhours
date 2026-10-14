// Small-range backfill test: 39600000..39620000 (20k blocks) to validate decode + store
'use strict';
const path = require('path');
const { fetchRange, blockTimestamps, initDb, ingest } = require('../lib/pons_indexer');

const DB = path.join(__dirname, '..', 'data', 'pons.db');

(async () => {
  const from = 39600000, to = 39620000;
  const data = await fetchRange(from, to);
  console.log('launches', data.launches.length, 'swept', data.swept.length, 'graduated', data.graduated.length);

  if (data.launches.length) {
    const blocks = [...data.launches.map((l) => l.block), ...data.swept.map((g) => g.block)];
    const tsMap = await blockTimestamps(blocks);
    const db = initDb(DB);
    ingest(db, data, tsMap);
    const rows = db.prepare('SELECT token, curve, deployer, pair_token, threshold, launched_at, block FROM pons_launches ORDER BY block LIMIT 5').all();
    for (const r of rows) {
      console.log('L', r.token.slice(0, 10), 'curve', r.curve.slice(0, 10), 'pair', r.pair_token.slice(0, 10), 'thr', (BigInt(r.threshold) / 10n ** 18n).toString(), 'ETH', 'at', new Date(r.launched_at * 1000).toISOString(), 'blk', r.block);
    }
    const gs = db.prepare('SELECT token, graduated_at, block FROM pons_graduations ORDER BY block LIMIT 5').all();
    for (const g of gs) console.log('G', g.token.slice(0, 10), new Date(g.graduated_at * 1000).toISOString(), 'blk', g.block);
    const cnt = db.prepare('SELECT COUNT(*) c FROM pons_launches').get();
    console.log('total in db so far', cnt.c);
    db.close();
  } else {
    console.log('NO LAUNCHES in range — widening needed');
  }
  process.exit(0);
})().catch((e) => { console.log('FATAL', e.message); process.exit(1); });
