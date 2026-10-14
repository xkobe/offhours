// GET /api/events?symbol=NVDA&days=7 — premium excursions from the remote DB.
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
      const raw = db
        .prepare('SELECT * FROM premium_events WHERE symbol = ? AND started_at >= ? ORDER BY started_at DESC LIMIT 200')
        .all(sym, since);
      const filtered = raw.filter((e) => Math.abs(e.peak_premium) <= 1000);
      json(res, 200, { symbol: sym, days, count: filtered.length, filteredOut: raw.length - filtered.length, rows: filtered });
    } finally {
      db.close();
    }
  } catch (e) {
    json(res, 502, { error: e.message });
  }
};
