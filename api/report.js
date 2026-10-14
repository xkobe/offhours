// GET /api/report?symbol=NVDA — verifiable report (computed locally, no DB needed).
'use strict';
const remote = require('../lib/remote');
const { json, parseQuery } = require('../lib/fn');

module.exports = async function handler(req, res) {
  try {
    const { q } = parseQuery(req.url);
    const sym = (q.get('symbol') || '').trim().toUpperCase();
    if (!sym) { json(res, 400, { error: 'symbol required' }); return; }

    const snap = await remote.getSnapshot();
    const { generateReportWithAnchor } = require('../lib/report');
    try {
      const { report, hash, ipfsCid } = generateReportWithAnchor(sym, snap);
      json(res, 200, { report, hash, ipfsCid });
    } catch (e) {
      json(res, 404, { error: e.message });
    }
  } catch (e) {
    json(res, 502, { error: e.message });
  }
};
