// HoodScope report engine (stage 2)
// Generates a structured, evidence-chain report for one (or all) Stock Tokens.
// Compliance: data presentation only — no buy/sell/recommendation language.
const { sha256Hex, cidV0FromSha256 } = require('./verify');

const SCHEMA_VERSION = '1.0';
const ANOMALY_OFFHOURS_PCT = 2;
const ANOMALY_ANYTIME_PCT = 10;

function buildEvidence(row, market) {
  const evidence = [];
  if (row.ref) {
    if (row.ref.source === 'chainlink') {
      evidence.push({
        type: 'chainlink_latest_round',
        feed: row.ref.feed,
        roundId: row.ref.roundId ? String(row.ref.roundId) : null,
        answer: row.ref.price,
        updatedAt: row.ref.updatedAt ? Number(row.ref.updatedAt) : null,
        stale: !!row.ref.stale,
      });
    } else if (row.ref.source === 'rhj') {
      evidence.push({
        type: 'rhj_quote',
        bid: row.ref.bid,
        ask: row.ref.ask,
        generatedAt: row.ref.generatedAt || null,
        dailyVolume: row.ref.dailyVolume || null,
        dailyHigh: row.ref.dailyHigh || null,
        dailyLow: row.ref.dailyLow || null,
        isTradingHalt: row.ref.isTradingHalt || false,
        multiplierApplied: row.multiplier,
      });
    }
  }
  if (row.dex) {
    evidence.push({
      type: 'uniswap_v3_pool',
      pool: row.dex.pool,
      fee: row.dex.fee,
      quote: row.dex.quote,
      priceUsd: row.dex.price,
      tvlUsd: row.dex.tvl,
    });
  }
  return evidence;
}

function isAnomaly(row, market) {
  if (row.premium === null) return false;
  const a = Math.abs(row.premium);
  return (market && market.offHours && a > ANOMALY_OFFHOURS_PCT) || a > ANOMALY_ANYTIME_PCT;
}

// Full report for a single symbol.
function generateReport(symbol, snapshot) {
  const row = snapshot.tokens.find((t) => t.symbol === symbol.toUpperCase());
  if (!row) throw new Error('symbol not found in snapshot: ' + symbol);

  const report = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'stock_token_analysis',
    generatedAt: snapshot.generatedAt,
    chain: { id: snapshot.chain.id, name: snapshot.chain.name, block: snapshot.chain.block, rpc: snapshot.chain.rpc },
    market: snapshot.market,
    ethUsd: snapshot.ethUsd,
    token: {
      symbol: row.symbol,
      name: row.name,
      address: row.address,
      type: row.type,
      multiplier: row.multiplier,
    },
    reference: row.ref
      ? {
          source: row.ref.source,
          price: row.ref.price,
          ...(row.ref.roundId ? { roundId: String(row.ref.roundId) } : {}),
          ...(row.ref.updatedAt ? { updatedAt: Number(row.ref.updatedAt) } : {}),
          ...(row.ref.stale !== undefined ? { stale: row.ref.stale } : {}),
        }
      : null,
    dex: row.dex
      ? { price: row.dex.price, pool: row.dex.pool, fee: row.dex.fee, quote: row.dex.quote, tvlUsd: row.dex.tvl }
      : null,
    premiumPct: row.premium,
    tvlUsd: row.tvl,
    anomaly: isAnomaly(row, snapshot.market),
    evidenceChain: buildEvidence(row, snapshot.market),
    compliance: { note: '数据呈现，非投资建议；所有数据点均可在链上/源站独立核验。' },
  };
  return report;
}

// Batch reports for the whole snapshot (used by premium_snapshot / listing health views).
function generateReports(snapshot) {
  return snapshot.tokens.map((row) => {
    const report = generateReport(row.symbol, snapshot);
    report.hash = sha256Hex(report);
    report.ipfsCid = cidV0FromSha256(report.hash);
    return report;
  });
}

// Single report + its anchor metadata (hash + CID)
function generateReportWithAnchor(symbol, snapshot) {
  const report = generateReport(symbol, snapshot);
  const hash = sha256Hex(report);
  return { report, hash, ipfsCid: cidV0FromSha256(hash) };
}

module.exports = { generateReport, generateReports, generateReportWithAnchor, SCHEMA_VERSION };
