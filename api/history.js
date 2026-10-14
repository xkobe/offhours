// GET /api/history?symbol=NVDA&days=7 — persisted price series from the remote DB.
'use strict';
const remote = require('../lib/remote');
const { json, parseQuery } = require('../lib/fn');

module.exports = async function handler(req, res) {
  try {
    const { q } = parseQuery(req.url);
    const sym = (q.get('symbol') || '').trim().toUpperCase();
    const days = Math.min(parseInt(q.get('days') || '7', 10) || 7, 90);
    if (!sym) { json(res, 400, { error: 'symbol required' }); return; }

    const db = await remote.openDb();
    try {
      const since = new Date(Date.now() - days * 864e5).toISOString();
      const rows = db
        .prepare('SELECT generated_at, ref_source, ref_price, dex_price, premium, tvl, off_hours, dex_pool, dex_fee, multiplier FROM token_prices WHERE symbol = ? AND generated_at >= ? AND dex_price IS NOT NULL ORDER BY generated_at ASC LIMIT 2000')
        .all(sym, since)
        .map((r) => ({ ...r, premium: r.premium === null ? null : Number(r.premium) }));
      json(res, 200, { symbol: sym, days, count: rows.length, rows });
    } finally {
      db.close();
    }
  } catch (e) {
    json(res, 502, { error: e.message });
  }
};
