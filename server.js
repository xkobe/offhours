// HoodScope — Robinhood Chain Stock Token screening server
// Serves the dashboard + cached JSON snapshot + SQLite-backed history/report/evidence APIs.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildSnapshot } = require('./lib/data');
const store = require('./lib/store');
const { generateReportWithAnchor } = require('./lib/report');
const { cidV0FromSha256, verifyHash } = require('./lib/verify');
const { AlertEngine, formatAlert } = require('./lib/alerts');
const { sendMessage, isConfigured } = require('./lib/telegram');

const alertsEngine = new AlertEngine();

const PORT = process.env.PORT || 4663;
const REFRESH_MS = 5 * 60 * 1000;
const PUBLIC_DIR = path.join(__dirname, 'public');

let snapshot = null;      // last good snapshot
let building = false;
let lastError = null;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function refresh(force) {
  if (building) return snapshot;
  if (snapshot && !force) return snapshot;
  building = true;
  try {
    const s = await buildSnapshot();
    snapshot = s;
    lastError = null;
    // persist to SQLite (idempotent-ish: new snapshot rows each run)
    try {
      store.saveSnapshot(s);
      // quick event detection for anomalous symbols only (full universe runs in scripts/index.js)
      for (const t of s.tokens) {
        if (t.premium === null) continue;
        if (Math.abs(t.premium) <= 2) continue;
        store.detectPremiumEvents(t.symbol, 2, { days: 7, minPoints: 2 });
      }
    } catch (e) {
      console.error('[hoodscope] persist failed:', e.message);
    }
    console.log('[hoodscope] snapshot built', new Date().toISOString(), s.summary.total + ' tokens,', s.summary.withDex + ' with dex,', s.summary.anomalyCount + ' anomalies,', s.elapsedMs + 'ms');
    // premium threshold alerts (Telegram; dry-run until TELEGRAM_BOT_TOKEN set)
    let pushed = 0;
    for (const t of s.tokens) {
      const a = alertsEngine.evaluate({ ...t, market: s.market });
      if (a) {
        pushed++;
        const ok = await sendMessage(formatAlert(a));
        if (!ok.sent && !ok.dryRun) {
          // transient failure: allow retry next sweep
          alertsEngine.latched.delete(a.symbol); // AlertEngine latches per symbol
        }
      }
    }
    if (pushed) console.log('[hoodscope] alerts pushed:', pushed, isConfigured() ? '(live)' : '(dry-run — set TELEGRAM_BOT_TOKEN to activate)');
  } catch (e) {
    lastError = e.message;
    console.error('[hoodscope] build failed:', e.message);
  } finally {
    building = false;
  }
  return snapshot;
}

const json = (res, code, obj) => {
  let body;
  try {
    body = JSON.stringify(obj, (k, v) => (typeof v === 'bigint' ? v.toString() : v));
  } catch (e) {
    body = JSON.stringify({ error: 'serialization failed: ' + e.message });
  }
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
};

async function evidenceLookup(hash) {
  const registry = process.env.ANCHOR_REGISTRY_ADDRESS;
  if (!registry) return { status: 'not_configured', note: 'ANCHOR_REGISTRY_ADDRESS 未配置（部署锚定合约后填写）' };
  const artifactPath = path.join(__dirname, 'build', 'AnchorRegistry.json');
  if (!fs.existsSync(artifactPath)) return { status: 'not_configured', note: 'build/AnchorRegistry.json 缺失（先运行 node scripts/compile_anchor.js）' };
  const { abi } = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const hc = require('hoodchain');
  const client = hc.createHoodClient({ rpcUrl: process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com' });
  try {
    const rec = await client.public.readContract({ address: registry, abi, functionName: 'getAnchor', args: ['0x' + hash] });
    const chainRecord = { cid: rec[0], timestamp: Number(rec[1]), anchoredBy: rec[2] };
    const result = verifyHash(hash, chainRecord);
    return { status: 'verified', ...result, chainRecord };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/snapshot') {
      await refresh(false);
      if (!snapshot) { json(res, 503, { error: 'snapshot unavailable', detail: lastError }); return; }
      json(res, 200, snapshot);
      return;
    }
    if (url.pathname === '/api/refresh') {
      await refresh(true);
      if (!snapshot) { json(res, 503, { error: 'refresh failed', detail: lastError }); return; }
      json(res, 200, { ok: true, builtAt: snapshot.generatedAt });
      return;
    }
    if (url.pathname === '/api/report') {
      const sym = (url.searchParams.get('symbol') || '').trim().toUpperCase();
      if (!sym) { json(res, 400, { error: 'symbol required' }); return; }
      await refresh(false);
      if (!snapshot) { json(res, 503, { error: 'snapshot unavailable' }); return; }
      try {
        const { report, hash, ipfsCid } = generateReportWithAnchor(sym, snapshot);
        json(res, 200, { report, hash, ipfsCid });
      } catch (e) {
        json(res, 404, { error: e.message });
      }
      return;
    }
    if (url.pathname === '/api/history') {
      const sym = (url.searchParams.get('symbol') || '').trim().toUpperCase();
      const days = Math.min(parseInt(url.searchParams.get('days') || '7', 10) || 7, 90);
      if (!sym) { json(res, 400, { error: 'symbol required' }); return; }
      const rows = store.getHistory(sym, { days });
      json(res, 200, { symbol: sym, days, count: rows.length, rows });
      return;
    }
    if (url.pathname === '/api/events') {
      const sym = (url.searchParams.get('symbol') || '').trim().toUpperCase();
      const days = Math.min(parseInt(url.searchParams.get('days') || '7', 10) || 7, 90);
      if (!sym) { json(res, 400, { error: 'symbol required' }); return; }
      const raw = store.getPremiumEvents(sym, { days });
      // historical ref-sanity: drop absurd peaks (ref-source anomalies, e.g. WYFI +3413%)
      const filtered = raw.filter(function (e) { return Math.abs(e.peak_premium) <= 1000; });
      json(res, 200, { symbol: sym, days, count: filtered.length, filteredOut: raw.length - filtered.length, rows: filtered });
      return;
    }
    if (url.pathname === '/api/evidence') {
      const hash = (url.searchParams.get('hash') || '').trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(hash)) { json(res, 400, { error: 'hash must be 64 hex chars' }); return; }
      const localCid = cidV0FromSha256(hash);
      const lookup = await evidenceLookup(hash);
      json(res, 200, { hash, localCid, ...lookup });
      return;
    }
    if (url.pathname === '/api/token-info') {
      const sym = (url.searchParams.get('symbol') || '').trim().toUpperCase();
      if (!sym) { json(res, 400, { error: 'symbol required' }); return; }
      await refresh(false);
      if (!snapshot) { json(res, 503, { error: 'snapshot unavailable' }); return; }
      const t = snapshot.tokens.find((x) => x.symbol === sym);
      if (!t) { json(res, 404, { error: 'unknown symbol' }); return; }
      try {
        const hc = require('hoodchain');
        const client = hc.createHoodClient({ rpcUrl: process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com' });
        const erc20InfoAbi = [
          { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
          { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
          { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
          { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
        ];
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
      return;
    }
    if (url.pathname === '/api/pons/stats') {
      const period = ['day', 'week', 'month'].includes(url.searchParams.get('period')) ? url.searchParams.get('period') : 'day';
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10) || 30, 90);
      const pons = require('./lib/pons_stats');
      const s = await pons.stats(period, limit);
      json(res, 200, s);
      return;
    }
    if (url.pathname === '/api/pons/watch') {
      const token = (url.searchParams.get('token') || '').trim().toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(token)) { json(res, 400, { error: 'token address required (0x...)' }); return; }
      const pons = require('./lib/pons_stats');
      const w = await pons.watchProgress(token);
      json(res, 200, w);
      return;
    }
    if (url.pathname === '/api/pons/near') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '15', 10) || 15, 50);
      const days = Math.min(parseInt(url.searchParams.get('days') || '14', 10) || 14, 90);
      const pons = require('./lib/pons_stats');
      const n = await pons.nearGraduation(limit, days);
      json(res, 200, n);
      return;
    }
    if (url.pathname === '/api/health') {
      let storeStats = null;
      try { storeStats = store.getStats(); } catch { /* store not ready */ }
      json(res, 200, { ok: true, snapshot: !!snapshot, lastError, store: storeStats });
      return;
    }
    // static
    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    const full = path.join(PUBLIC_DIR, path.normalize(file));
    if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('forbidden'); return; }
    const data = fs.readFileSync(full);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

// background auto refresh
setInterval(() => { refresh(false).catch(() => {}); }, REFRESH_MS);

// boot: init store, build once (non-blocking)
try { store.init(); console.log('[hoodscope] store ready:', store.DB_PATH); } catch (e) { console.error('[hoodscope] store init failed:', e.message); }
refresh(true);

server.listen(PORT, () => {
  console.log('[hoodscope] listening on http://localhost:' + PORT);
});
