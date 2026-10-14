// Explore hoodchain registry + feed + pool capabilities
const hc = require('hoodchain');
const hk = require('hoodkit');

function show(label, v) {
  try {
    console.log('\n=== ' + label + ' ===');
    console.log(typeof v === 'string' ? v : JSON.stringify(v, (k, val) => (typeof val === 'bigint' ? val.toString() : val), 1).slice(0, 3000));
  } catch (e) {
    console.log(label, 'ERR', e.message);
  }
}

async function main() {
  show('MAINNET_FEED_URL', hc.MAINNET_FEED_URL);
  show('FEED_DECIMALS', hc.FEED_DECIMALS);
  show('MAINNET_ADDRESSES', hc.MAINNET_ADDRESSES);

  // Registry
  try {
    const reg = hc.getRegistry ? hc.getRegistry() : null;
    if (reg) {
      show('getRegistry() type', Array.isArray(reg) ? 'array len ' + reg.length : Object.keys(reg).slice(0, 30));
      show('registry sample', Array.isArray(reg) ? reg.slice(0, 3) : Object.entries(reg).slice(0, 3));
    }
  } catch (e) { console.log('getRegistry ERR', e.message); }

  try {
    const list = await hc.listStockTokens();
    show('listStockTokens() len', list && list.length);
    show('listStockTokens sample', list && list.slice(0, 5));
  } catch (e) { console.log('listStockTokens ERR', e.message); }

  try {
    const priced = await hc.listPricedStockTokens();
    show('listPricedStockTokens() len', priced && priced.length);
    show('priced sample', priced && priced.slice(0, 5));
  } catch (e) { console.log('listPricedStockTokens ERR', e.message); }

  // Stock token lookup
  try {
    const t = hc.getStockToken && hc.getStockToken('NVDA');
    show('getStockToken(NVDA)', t);
  } catch (e) { console.log('getStockToken ERR', e.message); }

  // Pool discovery via hoodkit
  try {
    const pools = await hk.discoverPools({ chainId: 4663, token: hc.getStockToken && hc.getStockToken('NVDA') });
    show('discoverPools(NVDA) len', pools && pools.length);
    show('pools sample', pools && pools.slice(0, 5));
  } catch (e) { console.log('discoverPools ERR', e.message); }
}

main();
