// Verify api/history.js result matches lib/store.getHistory on the same DB.
'use strict';
const store = require('../lib/store');
store.init();
const rows = store.getHistory('NVDA', { days: 7 });
console.log('store.getHistory NVDA rows:', rows.length);
const db = store.getDb();
const all = db.prepare("SELECT generated_at, dex_price FROM token_prices WHERE symbol='NVDA' ORDER BY generated_at DESC LIMIT 30").all();
for (const r of all) console.log(r.generated_at, 'dex=', r.dex_price);
const cnt = db.prepare("SELECT COUNT(*) c FROM token_prices WHERE symbol='NVDA' AND dex_price IS NOT NULL").get();
console.log('NVDA rows with dex in db:', cnt.c);
