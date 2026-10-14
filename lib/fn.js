// Shared helpers for Vercel functions.
'use strict';
function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  let body;
  try {
    body = JSON.stringify(obj, (k, v) => (typeof v === 'bigint' ? v.toString() : v));
  } catch (e) {
    body = JSON.stringify({ error: 'serialization failed: ' + e.message });
  }
  res.end(body);
}

function parseQuery(url) {
  const u = new URL(url, 'http://localhost');
  return { pathname: u.pathname, q: u.searchParams };
}

module.exports = { json, parseQuery };
