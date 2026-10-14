// Full Pons backfill with resume support (chunked, persists progress)
'use strict';
const path = require('path');
const fs = require('fs');
const { fetchRange, blockTimestamps, initDb, ingest, rpc, sleep } = require('../lib/pons_indexer');

const DB = process.env.PONS_DB || path.join(__dirname, '..', 'data', 'pons.db');
const START = 39600000;
const CHUNK = Number(process.env.PONS_CHUNK || 20000);

(async () => {
  const bn = await rpc('eth_blockNumber', []);
  const latest = Number(bn.result);
  const db = initDb(DB);

  let last = Number(db.prepare("SELECT v FROM pons_meta WHERE k='backfill_last'").get()?.v || START);
  if (last > START && last >= latest) { console.log('already complete at', last); process.exit(0); }
  if (last < START) last = START;

  // collect anchors once for the whole run (first..latest)
  const anchors = [];
  for (let i = 0; i < 80; i++) {
    const sb = Math.floor(START + ((latest - START) * i) / 79);
    for (let k = 0; k < 4; k++) {
      const r = await rpc('eth_getBlockByNumber', ['0x' + sb.toString(16), false]);
      if (r.result) { anchors.push({ block: sb, ts: Number(r.result.timestamp) }); break; }
      await sleep(800);
    }
  }
  anchors.sort((a, b) => a.block - b.block);

  const upsertMeta = db.prepare('INSERT OR REPLACE INTO pons_meta (k,v) VALUES (?,?)');
  let since = Date.now();
  while (last < latest) {
    const to = Math.min(last + CHUNK - 1, latest);
    try {
      const data = await fetchRange(last, to);
      if (data.launches.length || data.swept.length || data.graduated.length) {
        const blocks = [...new Set([...data.launches.map((l) => l.block), ...data.swept.map((g) => g.block), ...data.graduated.map((g) => g.block)])];
        const tsMap = await blockTimestamps(blocks, anchors);
        ingest(db, data, tsMap);
      }
      last = to + 1;
      upsertMeta.run('backfill_last', String(last));
      if (Date.now() - since > 15000) {
        console.log('progress', last, '/', latest, 'launches', db.prepare('SELECT COUNT(*) c FROM pons_launches').get().c, 'graduated', db.prepare('SELECT COUNT(*) c FROM pons_graduations').get().c);
        since = Date.now();
      }
    } catch (e) {
      console.log('chunk fail', last, '-', Math.min(last + CHUNK - 1, latest), e.message.slice(0, 100));
      await sleep(3000);
    }
  }
  upsertMeta.run('backfill_last', String(latest));
  console.log('DONE backfill to', latest, 'launches', db.prepare('SELECT COUNT(*) c FROM pons_launches').get().c, 'graduated', db.prepare('SELECT COUNT(*) c FROM pons_graduations').get().c);
  db.close();
  process.exit(0);
})().catch((e) => { console.log('FATAL', e.message); process.exit(1); });
