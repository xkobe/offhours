// Test the HoodScope alert engine: thresholds, escalation, hysteresis release,
// cooldown, direction change, message format, and Telegram dry-run.
// Run: node scripts/test_alerts.js
'use strict';
const { AlertEngine, formatAlert, parseThresholds } = require('../lib/alerts');
const { sendMessage } = require('../lib/telegram');

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name); } };

const mk = (symbol, premium, offHours = true) => ({
  symbol, name: symbol + ' Inc', premium,
  ref: { price: 100 }, dex: { price: 100 * (1 + premium / 100) },
  market: { offHours },
});

// 1. parseThresholds default + custom
ok(parseThresholds(undefined).join() === '1,2,3,5,10,20,50', 'default thresholds ladder');
ok(parseThresholds('2,5,10').join() === '2,5,10', 'custom thresholds');

// 2. latch at 2.5% crosses 2%
let e = new AlertEngine({ thresholds: [1, 2, 3, 5, 10, 20, 50], cooldownMs: 60000 });
let a = e.evaluate(mk('TEST', 2.5), 1000000);
ok(a !== null && a.threshold === 2 && a.direction === 'PREMIUM', 'latch at 2.5% -> threshold 2');
ok(a.premiumPct === 2.5, 'premium value in alert');

// 3. same level + same direction within cooldown -> silent
a = e.evaluate(mk('TEST', 2.7), 1005000);
ok(a === null, 'same-level repeat within cooldown silent');

// 4. cooldown expires but same direction/level -> still silent (no spam)
a = e.evaluate(mk('TEST', 2.6), 1000000 + 61000);
ok(a === null, 'steady above threshold stays silent after cooldown');

// 5. escalation: crossing the next threshold up fires immediately
a = e.evaluate(mk('TEST', 3.2), 1000000 + 65000);
ok(a !== null && a.threshold === 3, 'escalation to 3% fires (no cooldown)');

// 6. higher jump crosses multiple -> highest threshold
a = e.evaluate(mk('TEST', 6.1), 1000000 + 70000);
ok(a !== null && a.threshold === 5, 'jump to 6.1% -> threshold 5');

// 7. direction flip (premium -> discount) fires as new event
a = e.evaluate(mk('TEST2', -3.1), 2000000);
ok(a !== null && a.direction === 'DISCOUNT' && a.threshold === 3, 'discount flip fires');

// 8. hysteresis: 2.5 triggers 2; 1.8 (>1) still latched silent; 0.8 (<1) releases; 2.2 re-triggers
e = new AlertEngine({ thresholds: [1, 2], hysteresis: 0.5, cooldownMs: 60000 });
a = e.evaluate(mk('HY', 2.5), 3000000);
ok(a !== null && a.threshold === 2, 'hysteresis: trigger at 2.5');
a = e.evaluate(mk('HY', 1.8), 3001000);
ok(a === null, 'hysteresis: 1.8 (> release line 1) silent, no low-threshold spam');
a = e.evaluate(mk('HY', 0.8), 3002000);
ok(a === null, 'hysteresis: 0.8 (< 1) released silently');
a = e.evaluate(mk('HY', 2.2), 3003000);
ok(a !== null && a.threshold === 2, 'hysteresis: re-trigger after release');

// 9. no-dex tokens never alert
a = e.evaluate({ symbol: 'NODEX', premium: null, ref: { price: 1 }, dex: null, market: { offHours: true } }, 4000000);
ok(a === null, 'null premium never alerts');

// 10. message format
const msg = formatAlert({ symbol: 'HPE', name: 'HPE Inc', threshold: 2, premiumPct: -22.3, direction: 'DISCOUNT', refPrice: 17.2, dexPrice: 13.36, offHours: true, at: '2026-10-03T00:00:00Z' });
ok(msg.includes('DISCOUNT >2%') && msg.includes('−22.30%') && msg.includes('CLOSED'), 'message format');
console.log('---\n' + msg + '\n---');

// 11. telegram dry-run without token
(async () => {
  process.env.TELEGRAM_BOT_TOKEN = '';
  process.env.TELEGRAM_CHAT_ID = '';
  const r = await sendMessage(msg);
  ok(r.dryRun === true && r.sent === false, 'telegram dry-run without token');

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
