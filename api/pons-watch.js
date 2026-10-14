// GET /api/pons/watch?token=0x… — live graduation progress of one launchpad token.
'use strict';
const remote = require('../lib/remote');
const { json, parseQuery } = require('../lib/fn');

module.exports = async function handler(req, res) {
  try {
    const { q } = parseQuery(req.url);
    const token = (q.get('token') || '').trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(token)) { json(res, 400, { error: 'token address required (0x...)' }); return; }

    const ponsPath = await remote.getPonsDbPath();
    process.env.PONS_DB_PATH = ponsPath;
    const pons = require('../lib/pons_stats');
    const w = await pons.watchProgress(token);
    json(res, 200, w);
  } catch (e) {
    json(res, 502, { error: e.message });
  }
};
