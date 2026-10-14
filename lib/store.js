// HoodScope SQLite store (schema v2)
// Persists snapshots, per-token price history, premium events and pool sightings.
// Sync API (better-sqlite3). DB path: HOODSCOPE_DB env var, default ./data/hoodscope.db
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DEFAULT_DB = path.join(__dirname, '..', 'data', 'hoodscope.db');
const DB_PATH = process.env.HOODSCOPE_DB || DEFAULT_DB;

let db = null;

function ensureDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function init(dbPath = DB_PATH) {
  ensureDir(dbPath);
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generated_at TEXT NOT NULL,
      block INTEGER,
      eth_usd REAL,
      summary_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_generated_at ON snapshots(generated_at);

    CREATE TABLE IF NOT EXISTS token_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL,
      generated_at TEXT NOT NULL,
      symbol TEXT NOT NULL,
      name TEXT,
      address TEXT,
      multiplier REAL,
      type TEXT,
      ref_source TEXT,
      ref_price REAL,
      ref_round_id TEXT,
      ref_updated_at INTEGER,
      dex_price REAL,
      dex_pool TEXT,
      dex_fee INTEGER,
      dex_quote TEXT,
      dex_tvl REAL,
      premium REAL,
      tvl REAL,
      off_hours INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_tp_symbol_time ON token_prices(symbol, generated_at);
    CREATE INDEX IF NOT EXISTS idx_tp_snapshot ON token_prices(snapshot_id);

    CREATE TABLE IF NOT EXISTS premium_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      peak_premium REAL NOT NULL,
      peak_at TEXT NOT NULL,
      threshold REAL NOT NULL,
      direction TEXT NOT NULL,          -- 'above' = 溢价, 'below' = 折价
      off_hours INTEGER NOT NULL DEFAULT 0,
      detected_at TEXT NOT NULL,
      UNIQUE(symbol, threshold, started_at)
    );
    CREATE INDEX IF NOT EXISTS idx_pe_symbol_time ON premium_events(symbol, started_at);

    CREATE TABLE IF NOT EXISTS meta (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pools (
      address TEXT PRIMARY KEY,
      symbol TEXT,
      fee INTEGER,
      quote TEXT,
      tvl REAL,
      last_seen TEXT NOT NULL
    );
  `);
  return db;
}

function getDb() { return db; }

function close() { if (db) { db.close(); db = null; } }

// Persist one snapshot (snapshots + token_prices + pools) atomically.
function saveSnapshot(snap) {
  if (!db) throw new Error('store not initialized: call init() first');
  const tx = db.transaction((s) => {
    const insSnap = db.prepare(
      'INSERT INTO snapshots (generated_at, block, eth_usd, summary_json) VALUES (?,?,?,?)'
    );
    const r = insSnap.run(s.generatedAt, s.chain && s.chain.block, s.ethUsd, JSON.stringify(s.summary));
    const sid = r.lastInsertRowid;

    const insTok = db.prepare(`INSERT INTO token_prices (
      snapshot_id, generated_at, symbol, name, address, multiplier, type,
      ref_source, ref_price, ref_round_id, ref_updated_at,
      dex_price, dex_pool, dex_fee, dex_quote, dex_tvl,
      premium, tvl, off_hours
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

    const off = s.market && s.market.offHours ? 1 : 0;
    for (const t of s.tokens) {
      const ref = t.ref || null;
      const dex = t.dex || null;
      insTok.run(
        sid, s.generatedAt, t.symbol, t.name, t.address, t.multiplier, t.type,
        ref ? ref.source : null,
        ref ? ref.price : null,
        ref && ref.roundId ? String(ref.roundId) : null,
        ref && ref.updatedAt ? Number(ref.updatedAt) : null,
        dex ? dex.price : null,
        dex ? dex.pool : null,
        dex ? dex.fee : null,
        dex ? dex.quote : null,
        dex ? dex.tvl : null,
        t.premium, t.tvl, off
      );
    }

    const upsPool = db.prepare(`INSERT INTO pools (address, symbol, fee, quote, tvl, last_seen)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(address) DO UPDATE SET
        symbol=excluded.symbol, fee=excluded.fee, quote=excluded.quote,
        tvl=excluded.tvl, last_seen=excluded.last_seen`);
    for (const t of s.tokens) {
      if (!t.dex) continue;
      upsPool.run(t.dex.pool, t.symbol, t.dex.fee, t.dex.quote, t.dex.tvl, s.generatedAt);
    }
    return Number(sid);
  });
  return tx(snap);
}

// Latest snapshot metadata + summary
function getLatestSnapshot() {
  if (!db) throw new Error('store not initialized');
  return db.prepare('SELECT id, generated_at, block, eth_usd, summary_json FROM snapshots ORDER BY generated_at DESC LIMIT 1').get() || null;
}

// Time series for one symbol (only rows with a dex price by default)
function getHistory(symbol, opts = {}) {
  if (!db) throw new Error('store not initialized');
  const days = opts.days || 7;
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const limit = opts.limit || 2000;
  const rows = db.prepare(`SELECT generated_at, ref_source, ref_price, dex_price, premium, tvl, off_hours, dex_pool, dex_fee, multiplier
    FROM token_prices
    WHERE symbol = ? AND generated_at >= ? AND dex_price IS NOT NULL
    ORDER BY generated_at ASC LIMIT ?`).all(symbol, since, limit);
  return rows.map((r) => ({ ...r, premium: r.premium === null ? null : Number(r.premium) }));
}

// Detect contiguous premium excursions beyond |thresholdPct| and persist as events.
// opts.minPoints: minimum consecutive snapshot points to count as an event (default 1).
function detectPremiumEvents(symbol, thresholdPct, opts = {}) {
  if (!db) throw new Error('store not initialized');
  const days = opts.days || 7;
  const minPoints = opts.minPoints || 1;
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const rows = db.prepare(`SELECT generated_at, premium, off_hours FROM token_prices
    WHERE symbol = ? AND generated_at >= ? AND premium IS NOT NULL
    ORDER BY generated_at ASC`).all(symbol, since);

  const events = [];
  let seg = null;
  const closeSeg = () => {
    if (!seg) return;
    if (seg.points >= minPoints) {
      events.push({
        symbol,
        startedAt: seg.start,
        endedAt: seg.end,
        peakPremium: seg.peak,
        peakAt: seg.peakAt,
        threshold: thresholdPct,
        direction: seg.peak >= 0 ? 'above' : 'below',
        offHours: seg.off,
        detectedAt: new Date().toISOString(),
      });
    }
    seg = null;
  };
  for (const r of rows) {
    const p = Number(r.premium);
    const hit = Math.abs(p) >= thresholdPct;
    if (hit) {
      if (!seg) seg = { start: r.generated_at, end: r.generated_at, peak: p, peakAt: r.generated_at, off: r.off_hours ? 1 : 0, points: 1 };
      else {
        seg.end = r.generated_at;
        seg.points += 1;
        if (Math.abs(p) > Math.abs(seg.peak)) { seg.peak = p; seg.peakAt = r.generated_at; }
        if (r.off_hours) seg.off = 1;
      }
    } else {
      closeSeg();
    }
  }
  closeSeg();

  const ins = db.prepare(`INSERT OR IGNORE INTO premium_events
    (symbol, started_at, ended_at, peak_premium, peak_at, threshold, direction, off_hours, detected_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  const tx = db.transaction((evs) => { for (const e of evs) ins.run(e.symbol, e.startedAt, e.endedAt, e.peakPremium, e.peakAt, e.threshold, e.direction, e.offHours, e.detectedAt); });
  tx(events);
  return events;
}

function getPremiumEvents(symbol, opts = {}) {
  if (!db) throw new Error('store not initialized');
  const days = opts.days || 7;
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const limit = opts.limit || 200;
  return db.prepare(`SELECT * FROM premium_events
    WHERE symbol = ? AND started_at >= ?
    ORDER BY started_at DESC LIMIT ?`).all(symbol, since, limit);
}

function getStats() {
  if (!db) throw new Error('store not initialized');
  return {
    snapshots: db.prepare('SELECT COUNT(*) c FROM snapshots').get().c,
    priceRows: db.prepare('SELECT COUNT(*) c FROM token_prices').get().c,
    premiumEvents: db.prepare('SELECT COUNT(*) c FROM premium_events').get().c,
    pools: db.prepare('SELECT COUNT(*) c FROM pools').get().c,
    dbPath: DB_PATH,
    diskBytes: fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0,
  };
}

// ---- meta (indexer cursor etc.) ----
function getMeta(k) {
  if (!db) throw new Error('store not initialized');
  const r = db.prepare('SELECT v FROM meta WHERE k = ?').get(k);
  return r ? r.v : null;
}

function setMeta(k, v) {
  if (!db) throw new Error('store not initialized');
  db.prepare('INSERT INTO meta (k, v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, String(v));
}

module.exports = { init, getDb, close, saveSnapshot, getLatestSnapshot, getHistory, detectPremiumEvents, getPremiumEvents, getStats, getMeta, setMeta, DB_PATH };
