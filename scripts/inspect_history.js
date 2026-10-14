// Inspect historical data size for the Time Machine view
const s = require('../lib/store');
s.init();
const db = s.getDb();
const snaps = db.prepare('SELECT COUNT(*) c, MIN(generated_at) lo, MAX(generated_at) hi FROM snapshots').get();
const prices = db.prepare('SELECT COUNT(*) c, COUNT(DISTINCT symbol) syms FROM token_prices').get();
const events = db.prepare('SELECT COUNT(*) c FROM premium_events').get();
console.log('snapshots', JSON.stringify(snaps));
console.log('prices', JSON.stringify(prices));
console.log('events', JSON.stringify(events));
const bySym = db.prepare('SELECT symbol, COUNT(*) c FROM token_prices GROUP BY symbol ORDER BY c DESC LIMIT 5').all();
console.log('top symbols', JSON.stringify(bySym));
const sample = db.prepare("SELECT symbol, generated_at, ref_price, dex_price, premium FROM token_prices WHERE symbol='NVDA' ORDER BY generated_at LIMIT 3").all();
console.log('nvda sample', JSON.stringify(sample));
const evSample = db.prepare('SELECT * FROM premium_events ORDER BY started_at DESC LIMIT 3').all();
console.log('event sample', JSON.stringify(evSample));
