// Remote data access for serverless (Vercel) functions.
// Architecture: GitHub Actions indexes every 5 min and uploads
//   hoodscope.db / pons.db / snapshot.json  →  R2 public bucket.
// Functions here read from R2 (cached in /tmp), falling back to the local
// SQLite files when R2_PUBLIC_BASE is unset (dev on your own machine).
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = process.env.R2_PUBLIC_BASE || '';
const CACHE_MS = 5 * 60 * 1000;
const LOCAL_DB = process.env.HOODSCOPE_DB || path.join(__dirname, '..', 'data', 'hoodscope.db');
const LOCAL_PONS = process.env.PONS_DB_PATH || path.join(__dirname, '..', 'data', 'pons.db');

const mem = {}; // { key: { at, buf } } — per-instance cache (Vercel function instances)

function isConfigured() { return !!BASE; }

async function fetchBuf(key, url) {
  const now = Date.now();
  if (mem[key] && now - mem[key].at < CACHE_MS) return mem[key].buf;
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('remote fetch ' + key + ' failed: HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  mem[key] = { at: now, buf };
  return buf;
}

// Latest market snapshot (R2 snapshot.json, or rebuilt from local SQLite).
async function getSnapshot() {
  if (BASE) {
    const buf = await fetchBuf('snapshot', BASE + '/snapshot.json');
    return JSON.parse(buf.toString('utf8'));
  }
  const store = require('./store');
  store.init();
  const { buildSnapshotFromDb } = require('./snapshot_exporter');
  return buildSnapshotFromDb(store.getDb());
}

// Path to a readable main DB (downloads to /tmp on serverless).
async function getDbPath() {
  if (BASE) {
    const buf = await fetchBuf('db', BASE + '/hoodscope.db');
    const p = path.join('/tmp', 'hoodscope_remote.db');
    fs.writeFileSync(p, buf);
    return p;
  }
  return LOCAL_DB;
}

// Path to a readable Pons DB.
async function getPonsDbPath() {
  if (BASE) {
    const buf = await fetchBuf('ponsdb', BASE + '/pons.db');
    const p = path.join('/tmp', 'pons_remote.db');
    fs.writeFileSync(p, buf);
    return p;
  }
  return LOCAL_PONS;
}

async function openDb() {
  const Database = require('better-sqlite3');
  return new Database(await getDbPath(), { readonly: true });
}

async function openPonsDb() {
  const Database = require('better-sqlite3');
  return new Database(await getPonsDbPath(), { readonly: true });
}

module.exports = { isConfigured, getSnapshot, getDbPath, getPonsDbPath, openDb, openPonsDb };
