// Local harness: exercise the api/*.js Vercel functions exactly as Vercel would
// (module.exports = async function(req,res)), using the local SQLite fallback
// in lib/remote.js (no R2 configured). Run: node scripts/test_functions.js
'use strict';
const http = require('http');
const path = require('path');

const ROUTES = {
  '/api/snapshot': '../api/snapshot',
  '/api/history': '../api/history',
  '/api/events': '../api/events',
  '/api/token-info': '../api/token-info',
  '/api/report': '../api/report',
  '/api/evidence': '../api/evidence',
  '/api/refresh': '../api/refresh',
  '/api/pons/stats': '../api/pons-stats',
  '/api/pons/near': '../api/pons-near',
  '/api/pons/watch': '../api/pons-watch',
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const fn = ROUTES[u.pathname];
  if (!fn) { res.statusCode = 404; res.end('no route'); return; }
  try {
    const handler = require(fn);
    handler(req, res).catch((e) => { res.statusCode = 500; res.end('handler error: ' + e.message); });
  } catch (e) {
    res.statusCode = 500;
    res.end('load error: ' + e.message);
  }
});

const PORT = 4699;
server.listen(PORT, async () => {
  const out = [];
  const cases = [
    ['/api/snapshot', {}],
    ['/api/history?symbol=NVDA&days=7', {}],
    ['/api/events?symbol=NVDA&days=7', {}],
    ['/api/token-info?symbol=NVDA', {}],
    ['/api/report?symbol=NVDA', {}],
    ['/api/evidence?hash=' + 'a'.repeat(64), {}],
    ['/api/refresh', {}],
    ['/api/pons/stats?period=day&limit=7', { t: 30000 }],
    ['/api/pons/near?limit=5&days=14', { t: 30000 }],
    ['/api/pons/watch?token=0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e', { t: 30000 }],
    ['/api/history', {}], // 400 expected (no symbol)
    ['/api/evidence?hash=zz', {}], // 400 expected
  ];
  for (const [p, o] of cases) {
    const t0 = Date.now();
    try {
      const r = await fetch('http://localhost:' + PORT + p, { signal: AbortSignal.timeout(o.t || 20000) });
      const body = await r.text().catch(() => '');
      let note = '';
      try {
        const j = JSON.parse(body);
        if (p.includes('history')) note = ' rows=' + (j.rows || []).length;
        else if (p.includes('events')) note = ' events=' + (j.rows || []).length;
        else if (p.includes('snapshot')) note = ' tokens=' + (j.tokens || []).length + ' market=' + (j.market && j.market.offHours ? 'off' : 'hours');
        else if (p.includes('pons/stats')) note = ' total=' + j.total + ' graduated=' + j.graduated;
        else if (p.includes('pons/near')) note = ' near=' + (j.rows || []).length;
        else if (p.includes('report')) note = ' hash=' + (j.hash || '').slice(0, 16);
        else if (p.includes('evidence') && r.status === 200) note = ' cid=' + (j.localCid || '').slice(0, 12) + ' status=' + j.status;
        else if (p.includes('token-info')) note = ' supply=' + (j.totalSupplyHuman || '—');
        else note = ' msg=' + (j.error || j.note || '').slice(0, 40);
      } catch { note = ' non-json'; }
      out.push(r.status + ' ' + (Date.now() - t0) + 'ms ' + p + note);
    } catch (e) {
      out.push('ERR ' + p + ' :: ' + (e.message || e).slice(0, 90));
    }
  }
  const fs = require('fs');
  fs.writeFileSync(path.join(__dirname, '..', 'scripts', 'functions_test_out.txt'), out.join('\n'), 'utf8');
  console.log(out.join('\n'));
  server.close();
  process.exit(0);
});
