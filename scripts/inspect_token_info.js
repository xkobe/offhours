// Inspect /api/token-info response shape (premium field location).
'use strict';
const fs = require('fs');
const path = require('path');
(async () => {
  const r = await fetch('http://localhost:4663/api/token-info?symbol=NVDA', { signal: AbortSignal.timeout(30000) });
  const j = await r.json();
  const pick = {};
  for (const k of Object.keys(j)) {
    const v = j[k];
    pick[k] = typeof v === 'object' && v !== null ? '{' + Object.keys(v).slice(0, 8).join(',') + '}' : v;
  }
  fs.writeFileSync(path.join(__dirname, '..', 'scripts', 'token_info_out.txt'), JSON.stringify(pick, null, 2), 'utf8');
  process.exit(0);
})().catch((e) => {
  fs.writeFileSync(path.join(__dirname, '..', 'scripts', 'token_info_out.txt'), 'FATAL ' + String(e), 'utf8');
  process.exit(1);
});
