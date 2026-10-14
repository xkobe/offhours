// Deep dive: registry feeds, price reading, pool discovery APIs
const hc = require('hoodchain');
const hk = require('hoodkit');

function short(v) {
  return JSON.stringify(v, (k, val) => (typeof val === 'bigint' ? val.toString() : val));
}

async function main() {
  const reg = hc.getRegistry();
  const tokens = reg.tokens || [];
  console.log('registry tokens:', tokens.length);
  const withFeed = tokens.filter((t) => t.feed);
  console.log('tokens with feed:', withFeed.length);
  console.log('sample feeds:', withFeed.slice(0, 6).map((t) => t.symbol + ':' + t.feed).join('\n'));
  console.log('feedCount field:', reg.feedCount, 'tokenCount:', reg.tokenCount, 'stockBeacon:', reg.stockBeacon);

  // how subscribeFeed works (function source)
  console.log('\n=== subscribeFeed signature ===');
  console.log(String(hc.subscribeFeed).slice(0, 600));

  // getQuote signature
  console.log('\n=== getQuote signature ===');
  console.log(String(hc.getQuote).slice(0, 900));

  // hoodkit functions
  console.log('\n=== discoverPools ===');
  console.log(String(hk.discoverPools).slice(0, 900));
  console.log('\n=== loadPoolInfo ===');
  console.log(String(hk.loadPoolInfo).slice(0, 700));
  console.log('\n=== sqrtPriceX96ToPrice ===');
  console.log(String(hk.sqrtPriceX96ToPrice).slice(0, 400));
  console.log('\n=== streamPrices ===');
  console.log(String(hk.streamPrices).slice(0, 700));
  console.log('\n=== createIndexer ===');
  console.log(String(hk.createIndexer).slice(0, 900));
  console.log('\n=== streamSwaps ===');
  console.log(String(hk.streamSwaps).slice(0, 700));
}

main();
