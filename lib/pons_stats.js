// Pons statistics + live curve progress reads
'use strict';
const path = require('path');
const Database = require('better-sqlite3');
const { initDb, rpc, sleep } = require('./pons_indexer');

const DB = process.env.PONS_DB_PATH || path.join(__dirname, '..', 'data', 'pons.db');
const ZERO = '0x0000000000000000000000000000000000000000';

// Robinhood Chain official tokenized stocks/ETFs approved as Pons quote assets (bitquery docs)
const STOCK_QUOTES = {
  '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9': 'AAPL',
  '0x86923f96303d656e4aa86d9d42d1e57ad2023fdc': 'AMD',
  '0x12f190a9f9d7d37a250758b26824b97ce941bf54': 'AMZN',
  '0x48e39e56acdba37b09020c0b734a613c9a2f100a': 'BB',
  '0x6330d8c3178a418788df01a47479c0ce7ccf450b': 'COIN',
  '0x4ea005168d7f09a7a0ba9d1def21a479950e44c2': 'COST',
  '0xdf0992e440dd0be65bd8439b609d6d4366bf1cb5': 'CRCL',
  '0x941ae714ec6d8130c7b75d67160ca08f1e7d11dd': 'DELL',
  '0x1d11f0496982706c5e14a514d4e79f2e6bde4516': 'DJT',
  '0xc9a981fee1f9dec688bb123ccdecc63d0debfc4e': 'GLD',
  '0x1b0e319c6a659f002271b69db8a7df2f911c153e': 'GME',
  '0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3': 'GOOGL',
  '0xccee82fe024c36fa15e1005ede3e9e4787e23d09': 'HIMS',
  '0x8005d266423c7ea827372c9c864491e5786600ea': 'LLY',
  '0xc0d6457c16cc70d6790dd43521c899c87ce02f35': 'META',
  '0xe93237c50d904957cf27e7b1133b510c669c2e74': 'MSFT',
  '0xec262a75e413fafd0df80480274532c79d42da09': 'MSTR',
  '0xff080c8ce2e5feadaca0da81314ae59d232d4afd': 'MU',
  '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec': 'NVDA',
  '0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a': 'PLTR',
  '0xd5f3879160bc7c32ebb4dc785f8a4f505888de68': 'QQQ',
  '0xf0c4bf4c582cb3836e98394b1d4e7b7281101be8': 'RBLX',
  '0x05b37fb53a299a1b874a619e1c4c404d52c36f4c': 'RDDT',
  '0x84cab63bc87912e71ad199ff14a0ba45de68fef8': 'SKHY',
  '0xb90a19ff0af67f7779aff50a882a9cff42446400': 'SNDK',
  '0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea': 'SPCX',
  '0x117cc2133c37b721f49de2a7a74833232b3b4c0c': 'SPY',
  '0x322f0929c4625ed5bad873c95208d54e1c003b2d': 'TSLA',
  '0x58ffe4a942d3885baa22d7520691f611ef09e7aa': 'TSM',
  '0x5e81213613b6b86eab4c6c50d718d34359459786': 'TTWO',
  '0xa30fa36db767ad9ed3f7a60fc79526fb4d56d344': 'USO',
  '0x9e7abd3c9139d14e4c86dce0e455aab7a0c2fb3e': 'WYFI',
};
const STOCK_ADDRS = new Set(Object.keys(STOCK_QUOTES));
const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const CBBTC = '0xcec185eb182c47d1ba1efc84e6959e18cd620be4';

function getDb() {
  if (!require('fs').existsSync(DB)) return null;
  return initDb(DB);
}

function bucketKey(ts, period) {
  const d = new Date(ts * 1000);
  if (period === 'week') {
    // ISO week start (Monday)
    const day = (d.getUTCDay() + 6) % 7;
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
    return monday.toISOString().slice(0, 10);
  }
  if (period === 'month') return d.toISOString().slice(0, 7);
  return d.toISOString().slice(0, 10);
}

function periodLabel(period) { return period === 'week' ? 'week' : period === 'month' ? 'month' : 'day'; }

async function stats(period = 'day', limit = 30) {
  const db = getDb();
  if (!db) return { available: false, reason: 'pons.db not ready' };
  const total = db.prepare('SELECT COUNT(*) c FROM pons_launches').get().c;
  const graduated = db.prepare('SELECT COUNT(*) c FROM pons_graduations').get().c;
  const lastBackfill = db.prepare("SELECT v FROM pons_meta WHERE k='backfill_last'").get();

  // trend buckets
  const launches = db.prepare('SELECT launched_at ts, pair_token FROM pons_launches').all();
  const grads = db.prepare('SELECT graduated_at ts FROM pons_graduations').all();
  const buckets = {};
  for (const l of launches) {
    const k = bucketKey(l.ts, period);
    if (!buckets[k]) buckets[k] = { launches: 0, graduated: 0, stock: 0 };
    buckets[k].launches++;
    if (STOCK_ADDRS.has(l.pair_token.toLowerCase())) buckets[k].stock++;
  }
  for (const g of grads) {
    const k = bucketKey(g.ts, period);
    if (!buckets[k]) buckets[k] = { launches: 0, graduated: 0, stock: 0 };
    buckets[k].graduated++;
  }
  const trend = Object.entries(buckets)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-limit)
    .map(([k, v]) => ({ key: k, ...v, rate: v.launches ? +((v.graduated / v.launches) * 100).toFixed(2) : 0 }));

  const stockLaunches = launches.filter((l) => STOCK_ADDRS.has(l.pair_token.toLowerCase())).length;
  const rwaSymbols = {};
  for (const l of launches) {
    const a = l.pair_token.toLowerCase();
    if (STOCK_ADDRS.has(a)) rwaSymbols[STOCK_QUOTES[a]] = (rwaSymbols[STOCK_QUOTES[a]] || 0) + 1;
  }
  // recent stock-quoted launches with graduation status
  const gradSet = new Set(grads.map((g) => g.token));
  const recentStock = db.prepare(
    'SELECT token, curve, pair_token, threshold, launched_at, block FROM pons_launches ORDER BY launched_at DESC LIMIT 400'
  ).all()
    .filter((l) => STOCK_ADDRS.has(l.pair_token.toLowerCase()))
    .slice(0, 12)
    .map((l) => ({
      token: l.token,
      pairSymbol: STOCK_QUOTES[l.pair_token.toLowerCase()],
      threshold: l.threshold,
      launchedAt: l.launched_at,
      block: l.block,
      graduated: gradSet.has(l.token),
    }));

  db.close();
  return {
    available: true,
    total, graduated,
    rate: total ? +((graduated / total) * 100).toFixed(2) : 0,
    stockQuoted: stockLaunches,
    rwaSymbols,
    recentStock,
    backfillTo: lastBackfill ? Number(lastBackfill.v) : null,
    bucket: periodLabel(period),
    trend,
  };
}

// live curve reserve for a token: progress = quote balance / threshold
async function watchProgress(token) {
  const db = getDb();
  if (!db) return { available: false, reason: 'pons.db not ready' };
  const l = db.prepare('SELECT * FROM pons_launches WHERE token = ?').get(token.toLowerCase());
  if (!l) { db.close(); return { available: false, reason: 'token not launched on Pons V2' }; }
  const g = db.prepare('SELECT * FROM pons_graduations WHERE token = ?').get(token.toLowerCase());
  db.close();

  const threshold = BigInt(l.threshold);
  let balance = 0n;
  if (l.pair_token === ZERO) {
    for (let k = 0; k < 4; k++) {
      const r = await rpc('eth_getBalance', [l.curve, 'latest']);
      if (r.result) { balance = BigInt(r.result); break; }
      await sleep(800);
    }
  } else {
    // ERC20 balanceOf(curve)
    const sel = '0x70a08231';
    const data = sel + '000000000000000000000000' + l.curve.slice(2);
    for (let k = 0; k < 4; k++) {
      const r = await rpc('eth_call', [{ to: l.pair_token, data }, 'latest']);
      if (r.result) { balance = BigInt(r.result); break; }
      await sleep(800);
    }
  }
  const progress = threshold > 0n ? Number(balance) / Number(threshold) : 0;
  return {
    available: true,
    token: l.token, curve: l.curve, deployer: l.deployer,
    pairToken: l.pair_token, pairSymbol: STOCK_QUOTES[l.pair_token.toLowerCase()] || (l.pair_token === ZERO ? 'ETH' : l.pair_token.slice(0, 10)),
    threshold, balance: balance.toString(),
    progress: +Math.min(progress, 1).toFixed(4),
    graduated: !!g,
    graduatedAt: g ? g.graduated_at : null,
    launchedAt: l.launched_at,
    block: l.block,
  };
}

// near-graduation: ungraduated launches (recent window) sorted by live progress
async function nearGraduation(limit = 15, days = 14) {
  const db = getDb();
  if (!db) return { available: false, reason: 'pons.db not ready' };
  const lastBackfill = db.prepare("SELECT v FROM pons_meta WHERE k='backfill_last'").get();
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const candidates = db.prepare('SELECT token FROM pons_launches WHERE launched_at > ? AND token NOT IN (SELECT token FROM pons_graduations) ORDER BY launched_at DESC LIMIT 400').all(since);
  db.close();
  const out = [];
  for (const c of candidates) {
    try {
      const p = await watchProgress(c.token);
      if (p.available && !p.graduated) out.push(p);
    } catch (e) { /* skip */ }
    if (out.length >= limit * 3) break;
  }
  out.sort((a, b) => b.progress - a.progress);
  const windowEmpty = !candidates.length;
  return {
    available: true, days, list: out.slice(0, limit),
    windowEmpty,
    backfillTo: lastBackfill ? Number(lastBackfill.v) : null,
    note: windowEmpty && lastBackfill
      ? 'No ungraduated launches in this window yet — backfill still running (indexed to block ' + Number(lastBackfill.v).toLocaleString('en-US') + ').'
      : null,
  };
}

module.exports = { stats, watchProgress, nearGraduation, STOCK_QUOTES, STOCK_ADDRS, USDG, CBBTC };
