// End-to-end data pipeline test: registry -> Chainlink feeds -> Uniswap pools -> premium
const hc = require('hoodchain');
const hk = require('hoodkit');

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const client = hc.createHoodClient({ rpcUrl: RPC });

const ZERO = '0x0000000000000000000000000000000000000000';
const FEE_TIERS = [100, 500, 3000, 10000];

async function ethUsdFromWethUsdg() {
  // price of WETH in USDG via WETH/USDG pool
  const weth = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
  const usdg = hc.MAINNET_ADDRESSES.usdg;
  const factory = hc.MAINNET_ADDRESSES.uniswapV3Factory;
  const found = [];
  for (const fee of FEE_TIERS) {
    const pool = await client.public.readContract({
      address: factory,
      abi: [{ type: 'function', name: 'getPool', stateMutability: 'view', inputs: [{ type: 'address', name: 'tokenA' }, { type: 'address', name: 'tokenB' }, { type: 'uint24', name: 'fee' }], outputs: [{ type: 'address' }] }],
      functionName: 'getPool',
      args: [weth, usdg, fee],
    });
    if (pool && pool !== ZERO) found.push({ pool, fee });
  }
  console.log('WETH/USDG pools:', found);
  return found;
}

async function main() {
  // 1. read feeds for all 34 priced tokens
  const reg = hc.getRegistry();
  const tokens = reg.tokens.filter((t) => t.feed);
  console.log('priced tokens:', tokens.length);

  const feedCalls = tokens.map((t) => ({
    address: t.feed,
    abi: hc.aggregatorV3Abi,
    functionName: 'latestRoundData',
  }));
  const results = await client.public.multicall({ contracts: feedCalls, allowFailure: true });
  const quotes = {};
  tokens.forEach((t, i) => {
    const r = results[i];
    if (r.status === 'success') {
      const [roundId, answer, , updatedAt] = r.result;
      quotes[t.symbol] = {
        feed: t.feed,
        price: Number(answer) / 1e8,
        roundId: roundId.toString(),
        updatedAt: Number(updatedAt),
        updatedAtISO: new Date(Number(updatedAt) * 1000).toISOString(),
      };
    }
  });
  console.log('\nsample quotes:', JSON.stringify(
    Object.fromEntries(['NVDA', 'AAPL', 'TSLA', 'SPY'].filter((s) => quotes[s]).map((s) => [s, quotes[s]])),
    null, 1));

  // 2. discover pools for a few tokens
  for (const sym of ['NVDA', 'AAPL', 'TSLA', 'SPY', 'COIN']) {
    try {
      const tok = hc.getStockToken(sym);
      if (!tok) { console.log(sym, 'not in registry'); continue; }
      const pools = await hk.discoverPools(client, tok);
      console.log('\n', sym, 'pools:', pools.map((p) => ({ pool: p.pool, token0: p.token0, token1: p.token1, fee: p.fee })));
    } catch (e) {
      console.log(sym, 'discover ERR', e.message);
    }
  }

  // 3. WETH/USDG pools for ETH price
  const wethPools = await ethUsdFromWethUsdg();
  console.log('\nwethPools:', wethPools);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
