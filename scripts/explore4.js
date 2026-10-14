// Check hoodchain client creation + viem version
const hc = require('hoodchain');
console.log('viem version:', require('viem/package.json').version);
console.log('\n=== createHoodClient ===');
console.log(String(hc.createHoodClient).slice(0, 2000));
console.log('\n=== getQuote usage ===');
console.log(String(hc.getQuote).slice(0, 400));
