// Verify WYFI handling after the ref-sanity guard
'use strict';
(async () => {
  for (let i = 0; i < 12; i++) {
    try {
      const r = await fetch('http://localhost:4663/api/snapshot', { signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const s = await r.json();
        const wyfi = s.tokens.find((t) => t.symbol === 'WYFI');
        const unreliables = s.tokens.filter((t) => t.ref && t.ref.unreliable).map((t) => t.symbol);
        console.log('snapshot ok ·', s.summary.total, 'tokens ·', s.summary.withPrem, 'with premium · anomalies', s.summary.anomalyCount);
        console.log('WYFI:', JSON.stringify({ dex: wyfi.dex && wyfi.dex.price, ref: wyfi.ref && wyfi.ref.price, bid: wyfi.ref && wyfi.ref.bid, ask: wyfi.ref && wyfi.ref.ask, unreliable: wyfi.ref && wyfi.ref.unreliable, premium: wyfi.premium }));
        console.log('unreliable refs:', unreliables.join(', ') || '(none)');
        process.exit(0);
      }
    } catch (e) { /* still building */ }
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log('TIMEOUT waiting for snapshot');
  process.exit(1);
})();
