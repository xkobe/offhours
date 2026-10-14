// Smoke test: run the alert engine against the LIVE snapshot and print what
// would be pushed (dry-run). Mirrors server.js integration.
// Run: node scripts/smoke_alerts.js
'use strict';
const { AlertEngine, formatAlert } = require('../lib/alerts');

(async () => {
  const r = await fetch('http://localhost:4663/api/snapshot', { signal: AbortSignal.timeout(30000) });
  const s = await r.json();
  const eng = new AlertEngine();
  const fired = [];
  for (const t of s.tokens) {
    const a = eng.evaluate({ ...t, market: s.market });
    if (a) fired.push(a);
  }
  console.log('Snapshot:', s.summary.total, 'tokens ·', s.summary.anomalyCount, 'anomalies · market', s.market.offHours ? 'CLOSED' : 'OPEN');
  console.log('Alerts fired:', fired.length);
  for (const a of fired) console.log('---\n' + formatAlert(a));
})();
