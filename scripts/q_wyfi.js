const s = require('../lib/store');
s.init();
const db = s.getDb();
const rows = db.prepare("SELECT symbol, ref_source, ref_price, dex_price, dex_pool, dex_fee, dex_quote, dex_tvl, premium, multiplier, generated_at FROM token_prices WHERE symbol = 'WYFI' ORDER BY generated_at DESC LIMIT 3").all();
console.log(JSON.stringify(rows, null, 1));
// pool detail
const pools = db.prepare("SELECT * FROM pools WHERE symbol = 'WYFI'").all();
console.log('POOLS', JSON.stringify(pools, null, 1));
