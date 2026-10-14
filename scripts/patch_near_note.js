// Patch public/app.js: near-graduation empty state shows backend note (backfill progress)
const fs = require('fs');
const p = 'C:\\Users\\小可爱\\Doubao\\chats\\2026-09-16\\new-chat\\hoodscope\\public\\app.js';
let t = fs.readFileSync(p, 'utf8');
const old = "if (!n.list.length) { box.innerHTML = '<div class=\"empty-body\">No ungraduated launches in the last ' + n.days + ' days with meaningful progress.</div>'; return; }";
const neu = "if (!n.list.length) { box.innerHTML = '<div class=\"empty-body\">' + esc(n.note || 'No ungraduated launches in the last ' + n.days + ' days with meaningful progress.') + '</div>'; return; }";
if (!t.includes(old)) { console.error('ANCHOR_MISSING'); process.exit(1); }
t = t.replace(old, neu);
fs.writeFileSync(p, t, 'utf8');
console.log('NEAR_NOTE_PATCHED');
