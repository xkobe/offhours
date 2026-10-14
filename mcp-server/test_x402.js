// Quick end-to-end check of the x402 middleware (dev mode: real EIP-3009 signature, no settlement).
'use strict';
const fs = require('fs');
const path = require('path');
const x402 = require('./lib/x402');

const lines = [];
(async () => {
  for (const tool of ['premium_snapshot', 'stock_token_analysis', 'premium_history', 'pons_graduation_stats', 'pons_graduation_watch', 'evidence_verify']) {
    const r = await x402.charge(tool);
    lines.push([
      tool.padEnd(22),
      r.status,
      '| price', r.price,
      '| amount', r.amount,
      '| payer', r.payer ? r.payer.slice(0, 12) : '—',
      '| nonce', r.nonce || '—',
      '| sig', r.signature ? r.signature.slice(0, 18) + '…' : '—',
      '| settlement', r.settlement,
    ].join(' '));
    const line = await x402.chargeLine(tool);
    lines.push('  -> ' + line);
  }
  lines.push('');
  lines.push('PRICING: ' + JSON.stringify(x402.PRICING));
  lines.push('IS_LIVE: ' + x402.isLive() + ' PAYEE: ' + x402.payee().slice(0, 12) + '…');
  fs.writeFileSync(path.join(__dirname, 'test_x402_out.txt'), lines.join('\n'), 'utf8');
  process.exit(0);
})().catch((e) => {
  fs.writeFileSync(path.join(__dirname, 'test_x402_out.txt'), 'FATAL ' + (e && e.stack || String(e)), 'utf8');
  process.exit(1);
});
