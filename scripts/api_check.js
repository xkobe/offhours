// Verify parameterized API endpoints + slow endpoints with longer timeouts.
'use strict';
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:4663';

const out = [];
const checks = [
  ['/api/snapshot', {}],
  ['/api/history?symbol=NVDA&days=7', { t: 30000 }],
  ['/api/events?symbol=NVDA&days=7', { t: 30000 }],
  ['/api/token-info?symbol=NVDA', { t: 30000 }],
  ['/api/evidence?hash=0da5d2f5d87f6e4b8c9a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5061', { t: 30000 }],
  ['/api/pons/stats?period=day&limit=7', { t: 30000 }],
  ['/api/pons/near?limit=5', { t: 60000 }],
  ['/api/refresh', { t: 120000, allowSlow: true }],
];

(async () => {
  for (const [p, o] of checks) {
    const t0 = Date.now();
    try {
      const r = await fetch(BASE + p, { signal: AbortSignal.timeout(o.t || 20000) });
      const ms = Date.now() - t0;
      const body = await r.text().catch(() => '');
      let note = '';
      if (r.status === 200) {
        try {
          const j = JSON.parse(body);
          if (p.includes('history')) note = ' rows=' + (j.rows || []).length + ' count=' + j.count;
          else if (p.includes('events')) note = ' events=' + (j.rows || []).length;
          else if (p.includes('pons/stats')) note = ' total=' + j.total + ' graduated=' + j.graduated + ' backfillTo=' + (j.backfillTo || '—');
          else if (p.includes('pons/near')) note = ' near=' + (j.rows || []).length;
          else if (p.includes('token-info')) note = ' symbol=' + (j.symbol || '—') + ' premium=' + (j.premium !== undefined ? j.premium : '—');
          else if (p.includes('evidence')) note = ' status=' + (j.status || '—');
          else if (p.includes('refresh')) note = ' ok=' + j.ok;
          else note = ' tokens=' + (j.tokens || []).length;
        } catch { note = ' non-json'; }
      }
      out.push(r.status + ' ' + ms + 'ms ' + p + note);
    } catch (e) {
      out.push('ERR ' + p + ' :: ' + (e.message || e).slice(0, 90));
    }
  }
  fs.writeFileSync(path.join(__dirname, '..', 'scripts', 'api_check_out.txt'), out.join('\n'), 'utf8');
  process.exit(0);
})().catch((e) => {
  fs.writeFileSync(path.join(__dirname, '..', 'scripts', 'api_check_out.txt'), 'FATAL ' + String(e), 'utf8');
  process.exit(1);
});
