// Inspect raw rhj price response for WYFI
'use strict';
(async () => {
  for (const sym of ['WYFI', 'NVDA']) {
    const url = 'https://api.robinhood.com/rhj/prices/' + sym;
    try {
      const r = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      console.log(sym, r.status, JSON.stringify(j).slice(0, 600));
    } catch (e) {
      console.log(sym, 'ERR', e.message);
    }
  }
})();
