// Full batched pipeline: registry -> feeds -> pools -> prices -> premium
// Validates the entire data computation for the DApp
const fs = require('fs');
const path = require('path');
const hc = require('hoodchain');
const hk = require('hoodkit');

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const client = hc.createHoodClient({ rpcUrl: RPC });

const ZERO = '0x0000000000000000000000000000000000000000';
const FEE_TIERS = [100, 500, 3000, 10000];
const factoryAbi = hc.uniswapV3FactoryAbi || [{ type: 'function', name: 'getPool', stateMutability: 'view', inputs: [{ type: 'address', name: 'tokenA' }, { type: 'address', name: 'tokenB' }, { type: 'uint24', name: 'fee' }], outputs: [{ type: 'address' }] }];
const slot0Abi = [{ type: 'function', name: 'slot0', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint160', name: 'sqrtPriceX96' }, { type: 'int24', name: 'tick' }, { type: 'uint16', name: 'observationIndex' }, { type: 'uint16', name: 'observationCardinality' }, { type: 'uint16', name: 'observationCardinalityNext' }, { type: 'uint8', name: 'feeProtocol' }, { type: 'bool', name: 'unlocked' }] }];
const erc20DecAbi = [{ type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }];
const balanceOfAbi = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }];

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

async function main() {
  const reg = hc.getRegistry();
  const regTokens = reg.tokens; // 95
  const bySym = {}; regTokens.forEach((t) => { bySym[t.symbol] = t; });

  // Load rhj assets (all 194)
  const rhj = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'rhj_assets.json'), 'utf8'));
  const assets = rhj.assets.filter((a) => a.deployments && a.deployments.some((d) => d.chainId === 4663));
  console.log('rhj assets on 4663:', assets.length);

  const tokenList = assets.map((a) => ({
    symbol: a.tokenSymbol,
    name: a.tokenName,
    address: a.deployments.find((d) => d.chainId === 4663).contractAddress,
    multiplier: a.currentMultiplier,
    feed: (bySym[a.tokenSymbol] && bySym[a.tokenSymbol].feed) || null,
    feedDecimals: (bySym[a.tokenSymbol] && bySym[a.tokenSymbol].feedDecimals) || null,
  }));
  const withFeed = tokenList.filter((t) => t.feed).length;
  console.log('tokens:', tokenList.length, 'with feed:', withFeed);

  // ---- 1. Feed prices (multicall) ----
  const feedTokens = tokenList.filter((t) => t.feed);
  const feedRes = await client.public.multicall({
    contracts: feedTokens.map((t) => ({ address: t.feed, abi: hc.aggregatorV3Abi, functionName: 'latestRoundData' })),
    allowFailure: true,
  });
  const refs = {};
  feedTokens.forEach((t, i) => {
    const r = feedRes[i];
    if (r.status === 'success' && r.result && r.result[1] > 0n) {
      const [roundId, answer, , updatedAt] = r.result;
      refs[t.symbol] = {
        source: 'chainlink',
        price: Number(answer) / 10 ** t.feedDecimals,
        feed: t.feed,
        roundId: roundId.toString(),
        updatedAt: Number(updatedAt),
      };
    }
  });
  console.log('feed quotes ok:', Object.keys(refs).length);

  // ---- 2. Probe pools for all tokens (batched) ----
  const usdg = hc.MAINNET_ADDRESSES.usdg.toLowerCase();
  const weth = hc.MAINNET_ADDRESSES.weth.toLowerCase();
  const factory = hc.MAINNET_ADDRESSES.uniswapV3Factory;
  const probes = [];
  const probeMeta = [];
  tokenList.forEach((t) => {
    const ta = t.address.toLowerCase();
    for (const quote of [usdg, weth]) {
      if (quote === ta) continue;
      for (const fee of FEE_TIERS) {
        probes.push({ address: factory, abi: factoryAbi, functionName: 'getPool', args: [t.address, quote, fee] });
        probeMeta.push({ symbol: t.symbol, quote, fee });
      }
    }
  });
  console.log('total getPool probes:', probes.length);
  const poolOf = {}; // 'sym|quote|fee' -> pool addr
  for (const pr of chunk(probes, 250)) {
    const res = await client.public.multicall({ contracts: pr, allowFailure: true });
    res.forEach((r, i) => {
      const meta = probeMeta[i];
      if (r.status === 'success' && r.result && r.result.toLowerCase() !== ZERO) {
        poolOf[meta.symbol + '|' + meta.quote + '|' + meta.fee] = r.result.toLowerCase();
      }
    });
  }
  const foundPools = [...new Set(Object.values(poolOf))];
  console.log('found pools:', foundPools.length);

  // ---- 3. Pool metadata (token0/token1/fee) + slot0 + balances ----
  const metaRes = await client.public.multicall({
    contracts: foundPools.flatMap((p) => [
      { address: p, abi: hk.uniswapV3PoolMetaAbi, functionName: 'token0' },
      { address: p, abi: hk.uniswapV3PoolMetaAbi, functionName: 'token1' },
      { address: p, abi: hk.uniswapV3PoolMetaAbi, functionName: 'fee' },
    ]),
    allowFailure: true,
  });
  const poolInfo = {};
  foundPools.forEach((p, i) => {
    const t0 = metaRes[i * 3], t1 = metaRes[i * 3 + 1], fee = metaRes[i * 3 + 2];
    if (t0.status === 'success' && t1.status === 'success' && fee.status === 'success') {
      poolInfo[p] = { token0: t0.result.toLowerCase(), token1: t1.result.toLowerCase(), fee: Number(fee.result) };
    }
  });
  // decimals for tokens involved
  const involved = [...new Set(Object.values(poolInfo).flatMap((p) => [p.token0, p.token1]))];
  const decRes = await client.public.multicall({
    contracts: involved.map((a) => ({ address: a, abi: erc20DecAbi, functionName: 'decimals' })),
    allowFailure: true,
  });
  const decimals = {};
  involved.forEach((a, i) => { const r = decRes[i]; if (r.status === 'success') decimals[a] = Number(r.result); });
  const slotRes = await client.public.multicall({
    contracts: foundPools.map((p) => ({ address: p, abi: slot0Abi, functionName: 'slot0' })),
    allowFailure: true,
  });
  const slot0 = {};
  foundPools.forEach((p, i) => { const r = slotRes[i]; if (r.status === 'success' && r.result) slot0[p] = r.result[0]; });

  // ---- 4. ETH price in USDG (WETH/USDG fee100) ----
  let ethUsd = null;
  for (const p of foundPools) {
    const info = poolInfo[p];
    if (info && ((info.token0 === weth && info.token1 === usdg) || (info.token0 === usdg && info.token1 === weth)) && info.fee === 100 && slot0[p]) {
      const d0 = decimals[info.token0] ?? 18, d1 = decimals[info.token1] ?? 18;
      const sq = Number(slot0[p]) / 2 ** 96;
      const P = sq * sq * 10 ** (d0 - d1);
      ethUsd = info.token0 === weth ? P : 1 / P;
      break;
    }
  }
  console.log('ETH/USD (via USDG pool):', ethUsd ? '$' + ethUsd.toFixed(2) : null);

  // ---- 5. Compute per-token dex price + premium ----
  const priceOf = (sqrt, d0, d1, tokenAddr) => {
    const sq = Number(sqrt) / 2 ** 96;
    const P = sq * sq * 10 ** (d0 - d1); // price of token0 in token1
    return P; // caller decides direction
  };
  const tokenUsd = {}; // sym -> {price, pool, poolFee, quote, tvl}
  tokenList.forEach((t) => {
    const ta = t.address.toLowerCase();
    const cands = [];
    for (const q of [usdg, weth]) {
      for (const fee of FEE_TIERS) {
        const key = t.symbol + '|' + q + '|' + fee;
        const pool = poolOf[key];
        if (!pool || !slot0[pool] || !poolInfo[pool]) continue;
        const info = poolInfo[pool];
        const d0 = decimals[info.token0] ?? 18, d1 = decimals[info.token1] ?? 18;
        const P = priceOf(slot0[pool], d0, d1, ta);
        let usd;
        if (info.token0 === ta) usd = q === usdg ? P : P * ethUsd;          // price of token in quote
        else if (info.token1 === ta) usd = q === usdg ? 1 / P : (1 / P) * ethUsd;
        if (usd > 0 && isFinite(usd)) cands.push({ price: usd, pool, fee, quote: q });
      }
    }
    if (cands.length) {
      cands.sort((a, b) => (a.quote === usdg ? 0 : 1) - (b.quote === usdg ? 0 : 1) || a.fee - b.fee);
      tokenUsd[t.symbol] = cands[0];
    }
  });
  console.log('tokens with dex price:', Object.keys(tokenUsd).length);

  // ---- 6. Merge + premium for validation sample ----
  const sample = ['NVDA', 'AAPL', 'TSLA', 'SPY', 'AMZN', 'COIN', 'MSTR', 'PLTR', 'AMD', 'HIMS'];
  console.log('\nsymbol   ref($)   dex($)   prem%   feedSrc');
  sample.forEach((s) => {
    const t = tokenList.find((x) => x.symbol === s);
    if (!t) { console.log(s, 'no token'); return; }
    const ref = refs[s] || null;
    const dex = tokenUsd[s];
    if (!ref) { console.log(s, 'no ref'); return; }
    if (!dex) { console.log(s, 'no dex'); return; }
    const prem = ((dex.price - ref.price) / ref.price) * 100;
    console.log(s.padEnd(8), ref.price.toFixed(2).padStart(8), dex.price.toFixed(2).padStart(8), prem.toFixed(2).padStart(7) + '%', ref.source);
  });

  fs.writeFileSync(path.join(__dirname, '..', 'pipeline_result.json'), JSON.stringify({ tokenUsd, refs, poolInfo, slot0: Object.fromEntries(Object.entries(slot0).map(([k, v]) => [k, v.toString()])) }, null, 1));
  console.log('\nsaved pipeline_result.json');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
