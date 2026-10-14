// Test the production data module
const { buildSnapshot } = require('../lib/data');

async function main() {
  const snap = await buildSnapshot();
  console.log('generatedAt:', snap.generatedAt, 'elapsed:', snap.elapsedMs + 'ms');
  console.log('chain block:', snap.chain.block, '| ETH/USD:', snap.ethUsd ? '$' + snap.ethUsd.toFixed(2) : 'null');
  console.log('market:', JSON.stringify(snap.market));
  console.log('summary:', JSON.stringify(snap.summary));
  const rows = snap.tokens;
  const prem = rows.filter((r) => r.premium !== null).sort((a, b) => b.premium - a.premium);
  console.log('\n=== top 12 premium ===');
  prem.slice(0, 12).forEach((r) => {
    console.log(
      r.symbol.padEnd(8),
      'ref', (r.ref ? r.ref.price : 0).toFixed(2).padStart(9),
      'dex', (r.dex ? r.dex.price : 0).toFixed(2).padStart(9),
      'prem', r.premium.toFixed(2).padStart(8) + '%',
      'tvl', r.tvl ? '$' + (r.tvl / 1e6).toFixed(1) + 'M' : '-',
      'src', r.ref ? r.ref.source : '-',
      'quote', r.dex ? r.dex.quote.slice(0, 4) : '-',
    );
  });
  console.log('\n=== bottom 8 (discounts) ===');
  prem.slice(-8).forEach((r) => {
    console.log(r.symbol.padEnd(8), 'prem', r.premium.toFixed(2).padStart(8) + '%', 'src', r.ref ? r.ref.source : '-');
  });
  // no-feed examples
  console.log('\n=== no-feed tokens with dex ===');
  rows.filter((r) => r.ref && r.ref.source === 'rhj' && r.dex).slice(0, 8).forEach((r) => {
    console.log(r.symbol.padEnd(8), 'ref', r.ref.price.toFixed(2), 'dex', r.dex.price.toFixed(2), 'prem', r.premium ? r.premium.toFixed(2) + '%' : '-', 'mult', r.multiplier);
  });
  console.log('\n=== tokens missing everything ===', rows.filter((r) => !r.ref && !r.dex).length);
  require('fs').writeFileSync(require('path').join(__dirname, '..', 'snapshot_test.json'), JSON.stringify(snap, null, 1));
  console.log('saved snapshot_test.json');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
