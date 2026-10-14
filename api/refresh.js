// GET /api/refresh — on Vercel the indexer runs in GitHub Actions, not here.
'use strict';
const { json } = require('../lib/fn');

module.exports = async function handler(req, res) {
  json(res, 200, {
    ok: false,
    note: 'refresh runs via GitHub Actions (index-incremental) every 5 min; this endpoint is informational on serverless.',
  });
};
