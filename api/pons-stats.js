// GET /api/pons/stats?period=day&limit=7 — graduation trends from the remote Pons DB.
'use strict';
const remote = require('../lib/remote');
const { json, parseQuery } = require('../lib/fn');

module.exports = async function handler(req, res) {
  try {
    const { q } = parseQuery(req.url);
    const period = ['day', 'week', 'month'].includes(q.get('period')) ? q.get('period') : 'day';
    const limit = Math.min(parseInt(q.get('limit') || '30', 10) || 30, 90);

    const ponsPath = await remote.getPonsDbPath();
    process.env.PONS_DB_PATH = ponsPath;
    const pons = require('../lib/pons_stats');
    const s = await pons.stats(period, limit);
    json(res, 200, s);
  } catch (e) {
    json(res, 502, { error: e.message });
  }
};
