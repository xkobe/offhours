// HoodScope alert engine — premium threshold alerts with hysteresis ladder
// Design (mirrors hood-alerts): a threshold latches when |premium| crosses it;
// it only releases when |premium| falls back below threshold × (1 - hysteresis),
// so off-hours noise does not spam repeated alerts. Cooldown per (symbol, threshold).
'use strict';

const DEFAULT_THRESHOLDS = [1, 2, 3, 5, 10, 20, 50];
const DEFAULT_HYSTERESIS = 0.5;   // release at 50% of threshold
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

function parseThresholds(raw) {
  if (!raw) return DEFAULT_THRESHOLDS;
  return String(raw).split(',').map((s) => parseFloat(s.trim())).filter((n) => isFinite(n) && n > 0);
}

class AlertEngine {
  constructor(opts = {}) {
    this.thresholds = parseThresholds(opts.thresholds || process.env.ALERT_THRESHOLDS);
    this.hysteresis = opts.hysteresis !== undefined ? opts.hysteresis : DEFAULT_HYSTERESIS;
    this.cooldownMs = opts.cooldownMs || DEFAULT_COOLDOWN_MS;
    // latched[`${symbol}|${threshold}`] = { since, lastPushAt, direction }
    this.latched = new Map();
  }

  // Evaluate one token; returns an alert object to push, or null.
  // token: { symbol, name, premium, ref:{price}, dex:{price}, market:{offHours} }
  // State machine per symbol: latch on first cross, escalate on next threshold up
  // (immediate), stay silent otherwise, release below threshold × (1 - hysteresis).
  evaluate(token, now = Date.now()) {
    const prem = token.premium;
    if (prem === null || prem === undefined || !isFinite(prem)) return null;
    const abs = Math.abs(prem);
    const sym = token.symbol;
    const st = this.latched.get(sym);
    const direction = prem >= 0 ? 'PREMIUM' : 'DISCOUNT';
    const ths = this.thresholds;

    // highest threshold index crossed (or -1)
    let hi = -1;
    for (let i = 0; i < ths.length; i++) { if (abs > ths[i]) hi = i; }

    const alertOf = (since) => ({
      symbol: sym, name: token.name || '', threshold: ths[this.latched.get(sym).level],
      premiumPct: prem, direction,
      refPrice: token.ref ? token.ref.price : null,
      dexPrice: token.dex ? token.dex.price : null,
      offHours: !!(token.market && token.market.offHours),
      sinceMs: since, at: new Date(now).toISOString(),
    });

    if (!st) {
      if (hi < 0) return null;
      this.latched.set(sym, { level: hi, lastPushAt: now, direction, since: now });
      return alertOf(now);
    }

    // direction flip => brand-new event
    if (st.direction !== direction) {
      this.latched.delete(sym);
      if (hi < 0) return null;
      this.latched.set(sym, { level: hi, lastPushAt: now, direction, since: now });
      return alertOf(now);
    }

    // escalation: crossed the next threshold up — push immediately (no cooldown)
    if (st.level < ths.length - 1 && abs > ths[st.level + 1]) {
      st.level += 1;
      st.lastPushAt = now;
      return alertOf(st.since);
    }

    // release: once |premium| falls below threshold × (1 - hysteresis),
    // un-latch immediately (independent of cooldown) so it can re-alert later
    if (abs < ths[st.level] * (1 - this.hysteresis)) {
      this.latched.delete(sym);
      return null;
    }

    // cooldown guard for same-level repeats
    if (now - st.lastPushAt < this.cooldownMs) return null;
    return null; // steady state: silent
  }
}

// Build the Telegram message text for an alert.
function formatAlert(a) {
  const pct = (v) => (v === null || v === undefined || !isFinite(v)) ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%';
  const usd = (v) => (v === null || v === undefined || !isFinite(v)) ? '—' : '$' + (v >= 1 ? v.toFixed(2) : v.toFixed(4));
  const lines = [
    '🚨 <b>HoodScope alert</b> · ' + a.direction + ' >' + a.threshold + '%',
    '<b>' + a.symbol + '</b>' + (a.name ? ' — ' + a.name : ''),
    'Premium: <b>' + pct(a.premiumPct) + '</b>',
    'Ref ' + usd(a.refPrice) + ' → DEX ' + usd(a.dexPrice),
    'Market: ' + (a.offHours ? 'CLOSED (off-hours)' : 'OPEN'),
    a.at + ' (UTC)',
  ];
  return lines.join('\n');
}

module.exports = { AlertEngine, formatAlert, DEFAULT_THRESHOLDS, parseThresholds };
