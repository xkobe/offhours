// HoodScope MCP Server — Stock Token premium intelligence on Robinhood Chain
// Tools: premium_snapshot / stock_token_analysis / premium_history /
//        pons_graduation_stats / pons_graduation_watch / evidence_verify
// Data comes from the HoodScope web API (HOODSCOPE_API_URL, default http://localhost:4663).
// Run: node index.js   (stdio transport — attach in Claude Desktop / Cursor / any MCP host)
'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const API = (process.env.HOODSCOPE_API_URL || 'http://localhost:4663').replace(/\/$/, '');
const NAME = 'hoodscope';
const VERSION = '0.2.0';

const x402 = require('./lib/x402');

async function apiGet(path) {
  const r = await fetch(API + path, { signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error('HoodScope API ' + r.status + ' ' + path);
  return r.json();
}

const out = (text) => ({ content: [{ type: 'text', text }] });
const err = (e) => ({ content: [{ type: 'text', text: 'ERROR: ' + (e && e.message ? e.message : String(e)) }], isError: true });

const USD = (v) => (v === null || v === undefined || !isFinite(v)) ? '—' : '$' + (v >= 1 ? v.toFixed(2) : v.toFixed(4));
const PCT = (v) => (v === null || v === undefined || !isFinite(v)) ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%';

// ---- shared snapshot helpers ----
function snapshotLine(t) {
  const prem = t.premium !== null ? PCT(t.premium) : 'no-dex';
  const tvl = t.dex && t.dex.tvl !== null ? '$' + (t.dex.tvl >= 1e6 ? (t.dex.tvl / 1e6).toFixed(1) + 'M' : t.dex.tvl >= 1e3 ? (t.dex.tvl / 1e3).toFixed(1) + 'k' : t.dex.tvl.toFixed(0)) : '—';
  return `${t.symbol}\t${t.name}\tref ${USD(t.ref ? t.ref.price : null)}\tdex ${USD(t.dex ? t.dex.price : null)}\tprem ${prem}\tmult ×${(t.multiplier || 1).toFixed(4)}\ttvl ${tvl}`;
}

async function getSnapshot() {
  const s = await apiGet('/api/snapshot');
  return s;
}

const server = new McpServer({ name: NAME, version: VERSION });

// ---------- 1. premium_snapshot ----------
server.registerTool('premium_snapshot', {
  title: 'Premium / discount snapshot',
  description: 'Live premium/discount snapshot of Robinhood Chain Stock Tokens: Chainlink reference price vs Uniswap V3 DEX price, sorted by premium. Optional symbol filter. Each row carries pool evidence. $0.01 USDG in production.',
  inputSchema: z.object({
    symbols: z.array(z.string()).optional().describe('Optional list of symbols, e.g. ["NVDA","TSLA"]. Omit for the full universe.'),
    limit: z.number().optional().describe('Max rows (default 25).'),
  }),
}, async (args) => {
  try {
    const pay = await x402.chargeLine('premium_snapshot');
    const s = await getSnapshot();
    const symbols = (args.symbols || []).map((x) => String(x).toUpperCase());
    let rows = s.tokens.filter((t) => t.premium !== null);
    if (symbols.length) rows = rows.filter((t) => symbols.includes(t.symbol));
    rows.sort((a, b) => (b.premium - a.premium));
    const limit = Math.min(parseInt(args.limit, 10) || 25, 194);
    const slice = rows.slice(0, limit);
    const lines = [
      `HoodScope premium snapshot · chain ${s.chain.id} · block ${s.chain.block || '—'} · ${s.generatedAt}`,
      pay,
      `Market ${s.market.offHours ? 'CLOSED' : 'OPEN'} (ET ${s.market.nyTime} ${s.market.weekday}) · ${s.summary.total} tokens · ${s.summary.withDex} with DEX price · ${s.summary.anomalyCount} anomalies`,
      '',
      'SYMBOL\tNAME\tREF\tDEX\tPREMIUM\tMULTIPLIER\tTVL',
      ...slice.map(snapshotLine),
      '',
      'Anomaly = |premium| > 2% while US market closed, or > 10% any time. Data presentation only, not investment advice.',
    ];
    return out(lines.join('\n'));
  } catch (e) { return err(e); }
});

// ---------- 2. stock_token_analysis ----------
server.registerTool('stock_token_analysis', {
  title: 'Full Stock Token analysis',
  description: 'Complete analysis of one Stock Token: reference vs DEX price, multiplier, premium history (persisted snapshots), premium events, evidence chain (feed/pool/block), and a verifiable report hash (SHA-256). $0.05 USDG in production.',
  inputSchema: z.object({
    symbol: z.string().describe('Stock Token symbol, e.g. NVDA.'),
  }),
}, async (args) => {
  try {
    const sym = String(args.symbol || '').trim().toUpperCase();
    if (!sym) return err(new Error('symbol required'));
    const pay = await x402.chargeLine('stock_token_analysis');
    const s = await getSnapshot();
    const t = s.tokens.find((x) => x.symbol === sym);
    if (!t) return err(new Error('unknown symbol: ' + sym + ' (see premium_snapshot for the universe)'));
    const [rep, hist, evs] = await Promise.all([
      apiGet('/api/report?symbol=' + encodeURIComponent(sym)),
      apiGet('/api/history?symbol=' + encodeURIComponent(sym) + '&days=14'),
      apiGet('/api/events?symbol=' + encodeURIComponent(sym) + '&days=14'),
    ]);
    const r = t;
    const lines = [
      pay,
      `ANALYSIS · ${r.symbol} · ${r.name} · type ${r.type} · multiplier ×${(r.multiplier || 1).toFixed(4)}`,
      `Reference: ${USD(r.ref ? r.ref.price : null)} (${r.ref ? (r.ref.source === 'chainlink' ? 'Chainlink feed ' + r.ref.feed : 'rhj bid × multiplier') : 'N/A'})`,
      `DEX: ${USD(r.dex ? r.dex.price : null)} (${r.dex ? 'Uniswap V3 ' + r.dex.pool + ' · ' + (r.dex.fee / 10000) + '%' : 'no USDG/WETH pool'})`,
      `Premium: ${PCT(r.premium)}  ${r.exec ? 'exec @$1k ' + PCT(r.exec[1000] === null ? NaN : r.exec[1000]) : ''}`,
      `Snapshot block ${s.chain.block || '—'} · ${s.generatedAt}`,
      '',
      'EVIDENCE',
      `Feed: ${r.ref && r.ref.feed ? r.ref.feed : '—'}${r.ref && r.ref.roundId ? ' · round ' + r.ref.roundId : ''}`,
      `Pool: ${r.dex ? r.dex.pool : '—'}${r.dex ? ' · TVL ' + USD(r.dex.tvl) : ''}`,
      `Token: ${r.address}`,
      '',
      'REPORT (verifiable)',
      `hash sha256: ${rep.hash}`,
      `ipfsCid: ${rep.ipfsCid || '—'} (pinning when IPFS configured)`,
      '',
      'PREMIUM HISTORY · ' + hist.count + ' persisted snapshots (14d)',
      ...hist.rows.slice(-10).map((h) => `${new Date(h.generated_at).toISOString()}\t${h.premium !== null ? h.premium.toFixed(2) + '%' : '—'}`),
      '',
      'PREMIUM EVENTS · |premium| > 2% (' + evs.count + ' in 14d)',
      ...evs.rows.map((e) => `${e.started_at ? new Date(e.started_at).toISOString() : '—'} → ${e.ended_at ? new Date(e.ended_at).toISOString() : 'ongoing'} · peak ${PCT(e.peak_premium)} · threshold ${e.threshold}%`),
      '',
      'Not investment advice.',
    ];
    return out(lines.join('\n'));
  } catch (e) { return err(e); }
});

// ---------- 3. premium_history ----------
server.registerTool('premium_history', {
  title: 'Premium history & events',
  description: 'Historical premium series (persisted SQLite snapshots) and premium events (|premium| > threshold crossings with start/peak/end) for a Stock Token. $0.03 USDG in production.',
  inputSchema: z.object({
    symbol: z.string().describe('Stock Token symbol.'),
    days: z.number().optional().describe('Lookback days (default 7, max 90).'),
  }),
}, async (args) => {
  try {
    const sym = String(args.symbol || '').trim().toUpperCase();
    if (!sym) return err(new Error('symbol required'));
    const days = Math.min(parseInt(args.days, 10) || 7, 90);
    const pay = await x402.chargeLine('premium_history');
    const [hist, evs] = await Promise.all([
      apiGet('/api/history?symbol=' + encodeURIComponent(sym) + '&days=' + days),
      apiGet('/api/events?symbol=' + encodeURIComponent(sym) + '&days=' + days),
    ]);
    const lines = [
      pay,
      `PREMIUM HISTORY · ${sym} · ${hist.count} snapshots over ${days}d`,
      ...hist.rows.map((h) => `${new Date(h.generated_at).toISOString()}\t${h.premium !== null ? h.premium.toFixed(2) + '%' : 'no dex'}`),
      '',
      `PREMIUM EVENTS · ${evs.count}`,
      ...evs.rows.map((e) => `${e.started_at ? new Date(e.started_at).toISOString() : '—'} → ${e.ended_at ? new Date(e.ended_at).toISOString() : 'ongoing'} · peak ${PCT(e.peak_premium)} · threshold ${e.threshold}%`),
      '',
      'Events = |premium| crossed the threshold; persisted by the indexer. Not investment advice.',
    ];
    return out(lines.join('\n'));
  } catch (e) { return err(e); }
});

// ---------- 4. pons_graduation_stats ----------
server.registerTool('pons_graduation_stats', {
  title: 'Pons launchpad graduation stats',
  description: 'Pons launchpad (Robinhood Chain) graduation trends: tokens issued, graduated at the on-chain bonding-curve threshold, graduation rate by day/week/month, plus stock/ETF-quoted launch counts (RWA x launchpad). Data is indexed directly from the Pons V2 factory on Robinhood Chain. $0.02 USDG in production.',
  inputSchema: z.object({
    period: z.enum(['day', 'week', 'month']).optional().describe('Aggregation period (default day).'),
    limit: z.number().optional().describe('Max trend buckets (default 30).'),
  }),
}, async (args) => {
  try {
    const period = args.period || 'day';
    const limit = Math.min(parseInt(args.limit, 10) || 30, 90);
    const pay = await x402.chargeLine('pons_graduation_stats');
    const s = await apiGet('/api/pons/stats?period=' + period + '&limit=' + limit);
    if (!s.available) return out('PONS GRADUATION STATS\n' + pay + '\nstatus: ' + (s.reason || 'unavailable'));
    const lines = [
      'PONS GRADUATION STATS · bucket ' + s.bucket + ' · chain 4663 · indexed to block ' + (s.backfillTo ? s.backfillTo.toLocaleString('en-US') : '—'),
      pay,
      'Launches (V2): ' + s.total.toLocaleString('en-US'),
      'Graduated: ' + s.graduated.toLocaleString('en-US') + ' (' + s.rate + '%)',
      'Stock/ETF-quoted launches: ' + s.stockQuoted.toLocaleString('en-US') + ' (' + (s.stockQuoted / s.total * 100).toFixed(1) + '% of all launches — RWA x launchpad)',
      'Top quoted symbols: ' + (Object.entries(s.rwaSymbols).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8).map(function (x) { return x[0] + ' x' + x[1]; }).join(', ') || '—'),
      '',
      'PERIOD\tLAUNCHES\tGRADUATED\tRATE%',
      ...s.trend.map(function (t) { return t.key + '\t' + t.launches + '\t' + t.graduated + '\t' + t.rate; }),
      '',
      'Graduation = bonding curve filled to the on-chain threshold → permanently locked Uniswap v4 pool. Data presentation only.',
    ];
    return out(lines.join('\n'));
  } catch (e) { return err(e); }
});

// ---------- 5. pons_graduation_watch ----------
server.registerTool('pons_graduation_watch', {
  title: 'Pons graduation watch',
  description: 'Live graduation progress of a specific Pons V2 launchpad token: quote balance in the bonding curve vs the on-chain graduation threshold, progress %, curve contract, quoted asset, and graduation status. Pass the token contract address (0x…). $0.01 USDG in production.',
  inputSchema: z.object({
    token: z.string().describe('Launchpad token contract address (0x…), e.g. from pons_graduation_stats or the dashboard.'),
  }),
}, async (args) => {
  try {
    const token = String(args.token || '').trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(token)) return err(new Error('token must be a 0x… contract address (40 hex chars)'));
    const pay = await x402.chargeLine('pons_graduation_watch');
    const w = await apiGet('/api/pons/watch?token=' + token);
    if (!w.available) return out('PONS GRADUATION WATCH\n' + pay + '\nstatus: ' + (w.reason || 'unavailable'));
    const lines = [
      pay,
      'PONS GRADUATION WATCH · ' + w.token.slice(0, 10) + '…',
      'Quoted asset: ' + w.pairSymbol,
      'Curve: ' + w.curve,
      'Graduation threshold: ' + (Number(w.threshold) / 1e18).toFixed(2) + ' ' + (w.pairSymbol === 'ETH' ? 'ETH' : 'units') + ' (on-chain)',
      'Quote balance in curve: ' + (Number(w.balance) / 1e18).toFixed(6),
      'Progress: ' + (w.progress * 100).toFixed(2) + '% of threshold',
      'Graduated: ' + (w.graduated ? 'YES' : 'NO') + (w.graduatedAt ? ' @ ' + new Date(w.graduatedAt * 1000).toISOString() : ''),
      'Launched: ' + new Date(w.launchedAt * 1000).toISOString() + ' · block ' + w.block,
      '',
      'When progress reaches 100%, the curve is swept into a permanently locked Uniswap v4 full-range position. Data presentation only.',
    ];
    return out(lines.join('\n'));
  } catch (e) { return err(e); }
});

// ---------- 6. evidence_verify ----------
server.registerTool('evidence_verify', {
  title: 'Verify a report hash on-chain',
  description: 'Verify the SHA-256 report hash: recomputes the CID fingerprint and checks the on-chain AnchorRegistry on Robinhood Chain (when configured). $0.01 USDG in production.',
  inputSchema: z.object({
    reportHash: z.string().describe('64-char SHA-256 hex hash returned by stock_token_analysis.'),
  }),
}, async (args) => {
  try {
    const hash = String(args.reportHash || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) return err(new Error('reportHash must be 64 hex chars'));
    const pay = await x402.chargeLine('evidence_verify');
    const res = await apiGet('/api/evidence?hash=' + encodeURIComponent(hash));
    const lines = [
      pay,
      'EVIDENCE VERIFY',
      `hash: ${res.hash}`,
      `cid fingerprint: ${res.localCid || '—'}`,
    ];
    if (res.status === 'not_configured') {
      lines.push('on-chain anchor: NOT CONFIGURED — AnchorRegistry contract compiled; deploy + set ANCHOR_REGISTRY_ADDRESS to activate.');
      lines.push('The hash itself is deterministic: recompute SHA-256 of the report JSON to cross-check independently.');
    } else if (res.status === 'verified') {
      lines.push(`on-chain anchor: VERIFIED — cid ${res.chainRecord ? res.chainRecord.cid : '—'} · anchored ${res.chainRecord ? new Date(res.chainRecord.timestamp * 1000).toISOString() : '—'} by ${res.chainRecord ? res.chainRecord.anchoredBy : '—'}`);
    } else if (res.status === 'not_found') {
      lines.push('on-chain anchor: NOT FOUND — no anchor record for this hash in the registry.');
    } else {
      lines.push('on-chain anchor: ' + (res.status || 'unknown'));
    }
    return out(lines.join('\n'));
  } catch (e) { return err(e); }
});

// ---------- transport ----------
const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  console.error('[hoodscope-mcp] ' + NAME + ' v' + VERSION + ' connected on stdio · API ' + API);
}).catch((e) => {
  console.error('[hoodscope-mcp] connect failed:', e.message);
  process.exit(1);
});
