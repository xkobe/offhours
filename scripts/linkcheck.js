// Dead-link & API smoke check for HoodScope.
// Scans public/index.html + app.js for internal hrefs/srcs and /api/ paths,
// then verifies every local API endpoint returns 200. External links reported
// as unchecked (no outbound calls).
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = process.env.HS_BASE || 'http://localhost:4663';
const PUB = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const app = fs.existsSync(path.join(PUB, 'app.js')) ? fs.readFileSync(path.join(PUB, 'app.js'), 'utf8') : '';
const all = html + '\n' + app;

// collect references
const refs = new Set();
for (const m of all.matchAll(/(?:href|src)="([^"]+)"/g)) refs.add(m[1]);
for (const m of all.matchAll(/["'`](\/api\/[^"'`\s?]+)/g)) refs.add(m[1]);
for (const m of all.matchAll(/fetch\(['"`]([^'"`]+)/g)) {
  const u = m[1];
  if (u.startsWith('/')) refs.add(u.split('?')[0]);
}
for (const m of all.matchAll(/apiGet\(['"`]([^'"`]+)/g)) {
  const u = m[1];
  if (u.startsWith('/')) refs.add(u.split('?')[0]);
}

const out = [];
out.push('=== REFS FOUND (' + refs.size + ') ===');
for (const r of [...refs].sort()) out.push('  ' + r);

const local = [...refs].filter((r) => r.startsWith('/api/'));
const files = [...refs].filter((r) => r.startsWith('/') && !r.startsWith('/api/') && !r.startsWith('//'));

out.push('');
out.push('=== LOCAL API CHECK ===');
(async () => {
  for (const p of local) {
    try {
      const r = await fetch(BASE + p, { signal: AbortSignal.timeout(15000) });
      out.push('  ' + r.status + ' ' + p);
    } catch (e) {
      out.push('  ERR ' + p + ' :: ' + (e.message || e).slice(0, 80));
    }
  }
  out.push('');
  out.push('=== STATIC FILE CHECK ===');
  for (const f of files) {
    const fp = path.join(PUB, f.replace(/^\//, ''));
    out.push('  ' + (fs.existsSync(fp) ? 'OK  ' : 'MISSING ') + f);
  }
  out.push('');
  out.push('=== EXTERNAL LINKS (unchecked, reported only) ===');
  for (const r of [...refs].filter((x) => /^https?:\/\//.test(x) && !x.includes('localhost'))) out.push('  ' + r);
  fs.writeFileSync(path.join(__dirname, '..', 'scripts', 'linkcheck_out.txt'), out.join('\n'), 'utf8');
  process.exit(0);
})().catch((e) => {
  fs.writeFileSync(path.join(__dirname, '..', 'scripts', 'linkcheck_out.txt'), 'FATAL ' + String(e && e.stack || e), 'utf8');
  process.exit(1);
});
