// GET /api/pons/near?limit=15&days=14 — near-graduation tokens from remote Pons DB.
'use strict';
const remote = require('../lib/remote');
const { json, parseQuery } = require('../lib/fn');

module.exports = async function handler(req, res) {
  try {
    const { q } = parseQuery(req.url);
    const limit = Math.min(parseInt(q.get('limit') || '15', 10) || 15, 50);
    const days = Math.min(parseInt(q.get('days') || '14', 10) || 14, 90);

    const ponsPath = await remote.getPonsDbPath();
    process.env.PONS_DB_PATH = ponsPath;
    const pons = require('../lib/pons_stats');
    const n = await pons.nearGraduation(limit, days);
    json(res, 200, n);
  } catch (e) {
    json(res, 502, { error: e.message });
  }
};
