// Pons V2 on-chain indexer: TokenLaunched / LaunchSwept / PoolGraduated
'use strict';
const https = require('https');
const Database = require('better-sqlite3');

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const FACTORY = '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e';
const TOPICS = {
  launched: '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607',
  swept: '0xcdb72f157fd3666758a6ce201387ffb52038c7562e4fff352828da1096c4b6b4',
  graduated: '0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259',
};

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const req = https.request(RPC, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('bad json')); } });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('timeout')));
    req.write(body); req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const word = (data, i) => '0x' + data.slice(2 + i * 64, 2 + (i + 1) * 64);
const bignum = (hex) => BigInt(hex);
const addr = (hex) => '0x' + hex.slice(26).toLowerCase();

async function getLogsOnce(topic, from, to) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await rpc('eth_getLogs', [{ address: FACTORY, topics: [topic], fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }]);
      if (r.error) { await sleep(500 * (i + 1)); continue; }
      return r.result;
    } catch (e) { await sleep(500 * (i + 1)); }
  }
  return null;
}

// fetch logs for a block range; returns {launches, swept, graduated}
async function fetchRange(from, to, chunk = 50000) {
  const out = { launches: [], swept: [], graduated: [] };
  let f = from;
  while (f <= to) {
    const t = Math.min(f + chunk - 1, to);
    const [ls, sw, gr] = await Promise.all([
      getLogsOnce(TOPICS.launched, f, t),
      getLogsOnce(TOPICS.swept, f, t),
      getLogsOnce(TOPICS.graduated, f, t),
    ]);
    if (!ls || !sw || !gr) throw new Error('getLogs failed at ' + f + '-' + t);
    for (const l of ls) {
      out.launches.push({
        token: addr(l.topics[1]), curve: addr(l.topics[2]), deployer: addr(l.topics[3]),
        pairToken: addr(word(l.data, 0)), launchConfigId: bignum(word(l.data, 1)).toString(),
        threshold: bignum(word(l.data, 2)).toString(), block: Number(l.blockNumber),
      });
    }
    for (const l of sw) {
      out.swept.push({ token: addr(l.topics[1]), quoteOut: bignum(word(l.data, 0)).toString(), tokenOut: bignum(word(l.data, 1)).toString(), block: Number(l.blockNumber) });
    }
    for (const l of gr) {
      out.graduated.push({ token: addr(l.topics[1]), positionId: bignum(word(l.data, 0)).toString(), tokenAmount: bignum(word(l.data, 1)).toString(), pairTokenAmount: bignum(word(l.data, 2)).toString(), block: Number(l.blockNumber) });
    }
    f = t + 1;
  }
  return out;
}

// block timestamps via linear interpolation between sampled anchors
async function blockTimestamps(blocks, anchors) {
  const need = [...new Set(blocks)].sort((a, b) => a - b);
  if (!anchors) {
    // sample ~60 evenly spaced anchors across [first, latest]
    const first = need[0], last = need[need.length - 1];
    const sampleBlocks = [];
    for (let i = 0; i < 60; i++) sampleBlocks.push(Math.floor(first + ((last - first) * i) / 59));
    anchors = [];
    for (const sb of sampleBlocks) {
      for (let k = 0; k < 4; k++) {
        const r = await rpc('eth_getBlockByNumber', ['0x' + sb.toString(16), false]);
        if (r.result) { anchors.push({ block: sb, ts: Number(r.result.timestamp) }); break; }
        await sleep(800);
      }
    }
    anchors.sort((a, b) => a.block - b.block);
  }
  const map = {};
  for (const b of need) {
    // find surrounding anchors
    let i = 0;
    while (i < anchors.length - 1 && anchors[i + 1].block < b) i++;
    const lo = anchors[i], hi = anchors[Math.min(i + 1, anchors.length - 1)];
    const span = hi.block - lo.block;
    const ts = span === 0 ? lo.ts : lo.ts + Math.round(((b - lo.block) / span) * (hi.ts - lo.ts));
    map[b] = ts;
  }
  return map;
}

function initDb(path) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS pons_launches (
      token TEXT PRIMARY KEY, curve TEXT, deployer TEXT, pair_token TEXT,
      launch_config_id TEXT, threshold TEXT, launched_at INTEGER, block INTEGER
    );
    CREATE TABLE IF NOT EXISTS pons_graduations (
      token TEXT PRIMARY KEY, block INTEGER, graduated_at INTEGER, quote_out TEXT, token_out TEXT
    );
    CREATE TABLE IF NOT EXISTS pons_meta (k TEXT PRIMARY KEY, v TEXT);
  `);
  return db;
}

async function ingest(db, data, tsMap) {
  const insL = db.prepare('INSERT OR REPLACE INTO pons_launches (token, curve, deployer, pair_token, launch_config_id, threshold, launched_at, block) VALUES (?,?,?,?,?,?,?,?)');
  const insG = db.prepare('INSERT OR REPLACE INTO pons_graduations (token, block, graduated_at, quote_out, token_out) VALUES (?,?,?,?,?)');
  const tx = db.transaction(() => {
    for (const l of data.launches) insL.run(l.token, l.curve, l.deployer, l.pairToken, l.launchConfigId, l.threshold, tsMap[l.block], l.block);
    for (const g of data.swept) insG.run(g.token, g.block, tsMap[g.block], g.quoteOut, g.tokenOut);
    for (const g of data.graduated) {
      db.prepare('INSERT OR REPLACE INTO pons_graduations (token, block, graduated_at, quote_out, token_out) VALUES (?,?,?,?,?)').run(g.token, g.block, tsMap[g.block], g.pairTokenAmount, g.tokenAmount);
    }
  });
  tx();
}

module.exports = { FACTORY, TOPICS, fetchRange, blockTimestamps, initDb, ingest, rpc, sleep };
