// Patch mcp-server/index.js: replace the two placeholder Pons tools with live API-backed implementations.
const fs = require('fs');
const p = 'C:\\Users\\小可爱\\Doubao\\chats\\2026-09-16\\new-chat\\hoodscope\\mcp-server\\index.js';
let t = fs.readFileSync(p, 'utf8');

const start = t.indexOf('// ---------- 4. pons_graduation_stats ----------');
const end = t.indexOf('// ---------- 6. evidence_verify ----------');
if (start < 0 || end < 0 || end <= start) { console.error('ANCHORS_MISSING', start, end); process.exit(1); }

const block = `// ---------- 4. pons_graduation_stats ----------
server.registerTool('pons_graduation_stats', {
  title: 'Pons launchpad graduation stats',
  description: 'Pons launchpad (Robinhood Chain) graduation trends: tokens issued, graduated at the on-chain bonding-curve threshold, graduation rate by day/week/month, plus stock/ETF-quoted launch counts (RWA x launchpad). Data is indexed directly from the Pons V2 factory on Robinhood Chain. \$0.02 USDG in production.',
  inputSchema: z.object({
    period: z.enum(['day', 'week', 'month']).optional().describe('Aggregation period (default day).'),
    limit: z.number().optional().describe('Max trend buckets (default 30).'),
  }),
}, async (args) => {
  try {
    const period = args.period || 'day';
    const limit = Math.min(parseInt(args.limit, 10) || 30, 90);
    const s = await apiGet('/api/pons/stats?period=' + period + '&limit=' + limit);
    if (!s.available) return out('PONS GRADUATION STATS\\nstatus: ' + (s.reason || 'unavailable'));
    const lines = [
      'PONS GRADUATION STATS · bucket ' + s.bucket + ' · chain 4663 · indexed to block ' + (s.backfillTo ? s.backfillTo.toLocaleString('en-US') : '—'),
      'Launches (V2): ' + s.total.toLocaleString('en-US'),
      'Graduated: ' + s.graduated.toLocaleString('en-US') + ' (' + s.rate + '%)',
      'Stock/ETF-quoted launches: ' + s.stockQuoted.toLocaleString('en-US') + ' (' + (s.stockQuoted / s.total * 100).toFixed(1) + '% of all launches — RWA x launchpad)',
      'Top quoted symbols: ' + (Object.entries(s.rwaSymbols).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8).map(function (x) { return x[0] + ' x' + x[1]; }).join(', ') || '—'),
      '',
      'PERIOD\\tLAUNCHES\\tGRADUATED\\tRATE%',
      ...s.trend.map(function (t) { return t.key + '\\t' + t.launches + '\\t' + t.graduated + '\\t' + t.rate; }),
      '',
      'Graduation = bonding curve filled to the on-chain threshold → permanently locked Uniswap v4 pool. Data presentation only.',
    ];
    return out(lines.join('\\n'));
  } catch (e) { return err(e); }
});

// ---------- 5. pons_graduation_watch ----------
server.registerTool('pons_graduation_watch', {
  title: 'Pons graduation watch',
  description: 'Live graduation progress of a specific Pons V2 launchpad token: quote balance in the bonding curve vs the on-chain graduation threshold, progress %, curve contract, quoted asset, and graduation status. Pass the token contract address (0x…). \$0.01 USDG in production.',
  inputSchema: z.object({
    token: z.string().describe('Launchpad token contract address (0x…), e.g. from pons_graduation_stats or the dashboard.'),
  }),
}, async (args) => {
  try {
    const token = String(args.token || '').trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(token)) return err(new Error('token must be a 0x… contract address (40 hex chars)'));
    const w = await apiGet('/api/pons/watch?token=' + token);
    if (!w.available) return out('PONS GRADUATION WATCH\\nstatus: ' + (w.reason || 'unavailable'));
    const lines = [
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
    return out(lines.join('\\n'));
  } catch (e) { return err(e); }
});

`;

t = t.slice(0, start) + block + t.slice(end);
fs.writeFileSync(p, t, 'utf8');
console.log('MCP_PONS_LIVE_PATCHED');
