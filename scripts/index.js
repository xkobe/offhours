// HoodScope incremental indexer — the scheduled entry point (cron / GitHub Actions / systemd timer).
// Pipeline: build snapshot → persist to SQLite → detect premium events → poll beacon upgrades.
// Env: RPC_URL (optional), PREMIUM_THRESHOLD (optional, default 2), HOODSCOPE_DB (optional)
const { buildSnapshot } = require('../lib/data');
const store = require('../lib/store');
const { getBeaconUpgradedEvents } = require('../lib/events');

const PREMIUM_THRESHOLD = parseFloat(process.env.PREMIUM_THRESHOLD || '2');

async function main() {
  store.init();
  const t0 = Date.now();

  const snap = await buildSnapshot();
  const sid = store.saveSnapshot(snap);

  // premium excursion detection across the universe (min 2 consecutive snapshots = ~10 min)
  let events = 0;
  for (const t of snap.tokens) {
    if (t.premium === null) continue;
    events += store.detectPremiumEvents(t.symbol, PREMIUM_THRESHOLD, { days: 7, minPoints: 2 }).length;
  }

  // issuer beacon upgrade polling, cursor persisted in meta
  let upgrades = [];
  const lastBlock = parseInt(store.getMeta('last_indexed_block') || '0', 10);
  const toBlock = snap.chain.block;
  if (lastBlock > 0 && toBlock && toBlock > lastBlock) {
    upgrades = await getBeaconUpgradedEvents({ fromBlock: lastBlock + 1, toBlock });
    for (const u of upgrades) console.log('[index] beacon upgrade @ block', u.blockNumber, '->', u.implementation);
  }
  if (toBlock) store.setMeta('last_indexed_block', toBlock);

  console.log(
    '[index] done in', Date.now() - t0, 'ms | snapshot', sid, '| tokens', snap.summary.total,
    '| premium events', events, '| beacon upgrades', upgrades.length
  );
}

main().catch((e) => { console.error('[index] failed:', e.message); process.exit(1); });
