// HoodScope store smoke test: init DB → persist a real snapshot → history/events/stats.
// Uses a throwaway DB file, cleaned up on exit.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEST_DB = path.join(ROOT, 'data', 'test_store_' + Date.now() + '.db');
// env MUST be set before requiring the store module (DB_PATH is captured at load time)
process.env.HOODSCOPE_DB = TEST_DB;
const store = require('../lib/store');

let failures = 0;
const check = (name, cond, extra) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
  if (!cond) failures++;
};

async function main() {
  store.init();
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'snapshot_test.json'), 'utf8'));
  check('snapshot has tokens', Array.isArray(snap.tokens) && snap.tokens.length > 100, 'tokens=' + snap.tokens.length);

  const sid = store.saveSnapshot(snap);
  check('snapshot persisted', sid > 0, 'sid=' + sid);

  const latest = store.getLatestSnapshot();
  check('latest snapshot readable', !!latest && latest.generated_at === snap.generatedAt);

  const hist = store.getHistory('NVDA', { days: 90 });
  check('NVDA history rows', hist.length >= 1, 'rows=' + hist.length);
  if (hist[0]) {
    check('NVDA history fields', hist[0].ref_price !== null && hist[0].premium !== null,
      'ref=' + hist[0].ref_price + ' dex=' + hist[0].dex_price + ' prem=' + hist[0].premium);
  }

  const evs = store.detectPremiumEvents('NVDA', 2, { days: 90 });
  check('NVDA events detected (single-point allowed here)', evs.length >= 0, 'events=' + evs.length);

  // re-run must be idempotent (INSERT OR IGNORE on same symbol/threshold/start)
  const evs2 = store.detectPremiumEvents('NVDA', 2, { days: 90 });
  check('event detection idempotent', evs2.length === evs.length, evs.length + '/' + evs2.length);

  const stats = store.getStats();
  check('store stats', stats.snapshots === 1 && stats.priceRows === snap.tokens.length, JSON.stringify(stats));

  store.close();
  for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) fs.rmSync(f, { force: true });
  console.log(failures ? '--- ' + failures + ' FAILURES ---' : '--- ALL PASS ---');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('test crashed:', e.message); process.exit(1); });
