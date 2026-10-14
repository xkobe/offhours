// GET /api/snapshot — latest market snapshot (R2 snapshot.json, or local SQLite).
'use strict';
const remote = require('../lib/remote');
const { json } = require('../lib/fn');

module.exports = async function handler(req, res) {
  try {
    const snap = await remote.getSnapshot();
    json(res, 200, snap);
  } catch (e) {
    json(res, 503, { error: 'snapshot unavailable', detail: e.message });
  }
};
