// HoodScope data pipeline: Robinhood Chain Stock Token screening data
// Sources: rhj REST API (assets/prices) + Chainlink feeds (RPC multicall) + Uniswap V3 pools (RPC)
const hc = require('hoodchain');
const hk = require('hoodkit');

const RPC_URL = process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
const RHJ = 'https://api.robinhood.com/rhj';
const ZERO = '0x0000000000000000000000000000000000000000';
const FEE_TIERS = [100, 500, 3000, 10000];

const client = hc.createHoodClient({ rpcUrl: RPC_URL });

const factoryAbi = [{ type: 'function', name: 'getPool', stateMutability: 'view', inputs: [{ type: 'address', name: 'tokenA' }, { type: 'address', name: 'tokenB' }, { type: 'uint24', name: 'fee' }], outputs: [{ type: 'address' }] }];
const slot0Abi = [{ type: 'function', name: 'slot0', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint160', name: 'sqrtPriceX96' }, { type: 'int24', name: 'tick' }, { type: 'uint16', name: 'observationIndex' }, { type: 'uint16', name: 'observationCardinality' }, { type: 'uint16', name: 'observationCardinalityNext' }, { type: 'uint8', name: 'feeProtocol' }, { type: 'bool', name: 'unlocked' }] }];
const erc20DecAbi = [{ type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }];
const balanceOfAbi = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }];

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- rhj REST helpers ----
async function rhjGet(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(RHJ + path, { signal: AbortSignal.timeout(15000) });
      if (r.status === 429 || r.status >= 500) { await sleep(500 * (attempt + 1)); continue; }
      if (!r.ok) throw new Error('rhj ' + r.status + ' ' + path);
      return await r.json();
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(400 * (attempt + 1));
    }
  }
}

async function fetchAssets() {
  const d = await rhjGet('/assets');
  const assets = (d.assets || []).filter((a) => a.deployments && a.deployments.some((x) => x.chainId === 4663));
  const reg = hc.getRegistry();
  const bySym = {};
  (reg.tokens || []).forEach((t) => { bySym[t.symbol] = t; });
  return assets.map((a) => {
    const dep = a.deployments.find((x) => x.chainId === 4663);
    const rt = bySym[a.tokenSymbol] || {};
    return {
      symbol: a.tokenSymbol,
      name: (a.tokenName || '').replace(/\s*•\s*Robinhood Token$/, ''),
      address: dep.contractAddress,
      multiplier: a.currentMultiplier,
      feed: rt.feed || null,
      feedDecimals: rt.feedDecimals || null,
      logo: a.logoUrl || null,
      tradingCapabilities: a.tradingCapabilities || null,
    };
  });
}

async function fetchRhjPrices(symbols) {
  const out = {};
  let i = 0;
  const worker = async () => {
    while (i < symbols.length) {
      const sym = symbols[i++];
      try {
        const d = await rhjGet('/prices/' + encodeURIComponent(sym));
        const q = d.quotes && d.quotes[0];
        if (q) out[sym] = {
          bid: parseFloat(q.bid), ask: parseFloat(q.ask),
          dailyVolume: parseFloat(q.dailyTradingVolume || '0'),
          generatedAt: q.generatedAt, isTradingHalt: !!q.isTradingHalt,
          dailyHigh: q.dailyHigh ? parseFloat(q.dailyHigh) : null,
          dailyLow: q.dailyLow ? parseFloat(q.dailyLow) : null,
        };
      } catch (e) { /* keep missing */ }
    }
  };
  await Promise.all(Array.from({ length: 10 }, worker));
  return out;
}

// ---- on-chain reads ----
async function readFeedQuotes(tokens) {
  const feedTokens = tokens.filter((t) => t.feed);
  if (!feedTokens.length) return {};
  const res = await client.public.multicall({
    contracts: feedTokens.map((t) => ({ address: t.feed, abi: hc.aggregatorV3Abi, functionName: 'latestRoundData' })),
    allowFailure: true,
  });
  const out = {};
  feedTokens.forEach((t, i) => {
    const r = res[i];
    if (r.status === 'success' && r.result && r.result[1] > 0n) {
      const [roundId, answer, , updatedAt] = r.result;
      out[t.symbol] = {
        price: Number(answer) / 10 ** (t.feedDecimals || 8),
        feed: t.feed, roundId: roundId.toString(), updatedAt: Number(updatedAt),
      };
    }
  });
  return out;
}

async function scanPools(tokens) {
  const usdg = hc.MAINNET_ADDRESSES.usdg;
  const weth = hc.MAINNET_ADDRESSES.weth;
  const factory = hc.MAINNET_ADDRESSES.uniswapV3Factory;
  const usdgL = usdg.toLowerCase(), wethL = weth.toLowerCase();

  // build probes: every token vs (usdg, weth) at every fee tier; plus weth vs usdg
  const targets = [...tokens.map((t) => ({ sym: t.symbol, addr: t.address })), { sym: 'WETH', addr: weth }];
  const probes = [], meta = [];
  targets.forEach(({ sym, addr }) => {
    const al = addr.toLowerCase();
    for (const quote of [usdg, weth]) {
      if (quote.toLowerCase() === al) continue;
      for (const fee of FEE_TIERS) {
        probes.push({ address: factory, abi: factoryAbi, functionName: 'getPool', args: [addr, quote, fee] });
        meta.push({ sym, quote: quote.toLowerCase(), fee });
      }
    }
  });

  const poolOf = {};
  let off = 0;
  for (const pr of chunk(probes, 250)) {
    const res = await client.public.multicall({ contracts: pr, allowFailure: true });
    res.forEach((r, i) => {
      const m = meta[off + i];
      if (r.status === 'success' && r.result && r.result.toLowerCase() !== ZERO) poolOf[m.sym + '|' + m.quote + '|' + m.fee] = r.result.toLowerCase();
    });
    off += pr.length;
  }

  const foundPools = [...new Set(Object.values(poolOf))];
  // pool metadata
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
  // decimals
  const involved = [...new Set(Object.values(poolInfo).flatMap((p) => [p.token0, p.token1]))];
  const decRes = await client.public.multicall({ contracts: involved.map((a) => ({ address: a, abi: erc20DecAbi, functionName: 'decimals' })), allowFailure: true });
  const decimals = {};
  involved.forEach((a, i) => { const r = decRes[i]; if (r.status === 'success') decimals[a] = Number(r.result); });
  // slot0
  const slotRes = await client.public.multicall({ contracts: foundPools.map((p) => ({ address: p, abi: slot0Abi, functionName: 'slot0' })), allowFailure: true });
  const slot0 = {};
  foundPools.forEach((p, i) => { const r = slotRes[i]; if (r.status === 'success' && r.result) slot0[p] = r.result[0]; });
  // liquidity (Uniswap V3 in-range liquidity; 0 => empty pool, keep only real pools)
  const liqAbi = [{ type: 'function', name: 'liquidity', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint128' }] }];
  const liqRes = await client.public.multicall({ contracts: foundPools.map((p) => ({ address: p, abi: liqAbi, functionName: 'liquidity' })), allowFailure: true });
  const liquidity = {};
  foundPools.forEach((p, i) => { const r = liqRes[i]; if (r.status === 'success' && r.result) liquidity[p] = r.result; });
  // balances for TVL
  const balRes = await client.public.multicall({
    contracts: foundPools.flatMap((p) => {
      const info = poolInfo[p]; if (!info) return [];
      return [
        { address: info.token0, abi: balanceOfAbi, functionName: 'balanceOf', args: [p] },
        { address: info.token1, abi: balanceOfAbi, functionName: 'balanceOf', args: [p] },
      ];
    }),
    allowFailure: true,
  });
  const balances = {};
  foundPools.forEach((p, i) => {
    const b0 = balRes[i * 2], b1 = balRes[i * 2 + 1];
    if (b0.status === 'success' && b1.status === 'success') balances[p] = [b0.result, b1.result];
  });

  return { poolOf, poolInfo, decimals, slot0, balances, liquidity, usdgL, wethL };
}

// TVL (USD) of a pool given its sqrt price, from balances
function poolTvlUsd(pool, sqrt, info, decimals, balances, ethUsd, usdgL, wethL) {
  const bal = balances[pool];
  if (!bal) return null;
  const d0 = decimals[info.token0] ?? 18, d1 = decimals[info.token1] ?? 18;
  const sq = Number(sqrt) / 2 ** 96;
  const P = sq * sq * 10 ** (d0 - d1); // price of token0 in token1
  const amt0 = Number(bal[0]) / 10 ** d0;
  const amt1 = Number(bal[1]) / 10 ** d1;
  // usd price per token0 / token1
  let p0 = null, p1 = null;
  if (info.token1 === usdgL) { p0 = P; p1 = 1; }          // quote USDG ~ $1
  else if (info.token0 === usdgL) { p0 = 1; p1 = P; }
  else if (info.token1 === wethL) { p0 = P * ethUsd; p1 = ethUsd; }
  else if (info.token0 === wethL) { p0 = ethUsd; p1 = P * ethUsd; }
  if (p0 === null || p1 === null || !isFinite(p0) || !isFinite(p1)) return null;
  return amt0 * p0 + amt1 * p1;
}

// price of `tokenAddr` in USD from pool sqrtPriceX96
function poolPriceUsd(sqrt, tokenAddr, info, decimals, ethUsd, usdgL, wethL) {
  const d0 = decimals[info.token0] ?? 18, d1 = decimals[info.token1] ?? 18;
  const sq = Number(sqrt) / 2 ** 96;
  const P = sq * sq * 10 ** (d0 - d1); // price of token0 in token1
  if (info.token0 === tokenAddr.toLowerCase()) {
    if (info.token1 === usdgL) return P;
    if (info.token1 === wethL) return P * ethUsd;
  } else if (info.token1 === tokenAddr.toLowerCase()) {
    if (info.token0 === usdgL) return 1 / P;
    if (info.token0 === wethL) return (1 / P) * ethUsd;
  }
  return null;
}

// ---- market hours (NYSE) ----
function marketStatus(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  const weekday = get('weekday'); // Fri, Mon...
  const hm = get('hour') + ':' + get('minute');
  const mins = (() => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; })();
  const isWeekday = !['Sat', 'Sun'].includes(weekday);
  const inHours = isWeekday && mins >= 570 && mins < 960; // 9:30 - 16:00
  return { offHours: !inHours, nyTime: hm, weekday };
}

// ---- main snapshot ----
async function buildSnapshot() {
  const t0 = Date.now();
  const tokens = await fetchAssets();
  const [feeds, pools, blockNum] = await Promise.all([
    readFeedQuotes(tokens),
    scanPools(tokens),
    client.public.getBlockNumber().catch(() => null),
  ]);

  // ETH price in USD from WETH/USDG pool (prefer fee 100)
  let ethUsd = null, ethPoolEvidence = null;
  const wethL = pools.wethL, usdgL = pools.usdgL;
  for (const fee of FEE_TIERS) {
    const key = 'WETH|' + usdgL + '|' + fee;
    const p = pools.poolOf[key];
    if (p && pools.slot0[p] && pools.poolInfo[p]) {
      const info = pools.poolInfo[p];
      const d0 = pools.decimals[info.token0] ?? 18, d1 = pools.decimals[info.token1] ?? 18;
      const sq = Number(pools.slot0[p]) / 2 ** 96;
      const P = sq * sq * 10 ** (d0 - d1);
      ethUsd = info.token0 === wethL ? P : 1 / P;
      ethPoolEvidence = { pool: p, fee, sqrtPriceX96: pools.slot0[p].toString() };
      break;
    }
  }

  // rhj prices for tokens without feed
  const noFeedSyms = tokens.filter((t) => !t.feed).map((t) => t.symbol);
  const rhjPrices = await fetchRhjPrices(noFeedSyms);

  // per-token dex price + evidence
  const rows = [];
  for (const t of tokens) {
    const ta = t.address.toLowerCase();
    const cands = [];
    for (const q of [usdgL, wethL]) {
      for (const fee of FEE_TIERS) {
        const p = pools.poolOf[t.symbol + '|' + q + '|' + fee];
        if (!p || !pools.slot0[p] || !pools.poolInfo[p]) continue;
        if (!pools.liquidity[p] || pools.liquidity[p] === 0n) continue; // only real, liquid pools
        const usd = poolPriceUsd(pools.slot0[p], ta, pools.poolInfo[p], pools.decimals, ethUsd, usdgL, wethL);
        if (usd && usd > 0 && isFinite(usd)) {
          const tvl = poolTvlUsd(p, pools.slot0[p], pools.poolInfo[p], pools.decimals, pools.balances, ethUsd, usdgL, wethL);
          cands.push({ price: usd, pool: p, fee, quote: q, tvl: tvl && isFinite(tvl) ? tvl : 0 });
        }
      }
    }
    // rank: USDG-quoted first, then by TVL desc, then lower fee
    cands.sort((a, b) => (a.quote === usdgL ? 0 : 1) - (b.quote === usdgL ? 0 : 1) || (b.tvl - a.tvl) || (a.fee - b.fee));
    const dex = cands[0] || null;

    // reference price
    let ref = null;
    if (feeds[t.symbol]) {
      const f = feeds[t.symbol];
      ref = {
        source: 'chainlink', price: f.price, feed: f.feed, roundId: f.roundId, updatedAt: f.updatedAt,
        stale: Date.now() / 1000 - f.updatedAt > 2 * 3600,
      };
    } else if (rhjPrices[t.symbol]) {
      const q = rhjPrices[t.symbol];
      const mult = parseFloat(t.multiplier) || 1;
      // Source sanity: rhj quotes can occasionally be nonsense (e.g. a bid far
      // below the ask or outside the day's range — seen with WYFI bid $0.51 vs
      // ask $19.45 / day range $17.5-19.2). When flagged, the token still shows
      // its DEX price but the premium is withheld (null) instead of a fake +3410%.
      const spread = q.ask > 0 ? (q.ask - q.bid) / q.bid : Infinity;
      const rangeOk = !(q.dailyHigh > 0 && q.dailyLow > 0) ||
        (q.bid >= q.dailyLow * 0.5 && q.bid <= q.dailyHigh * 2);
      const unreliable = !isFinite(spread) || spread > 0.25 || !rangeOk;
      ref = {
        source: 'rhj', price: q.bid * mult, bid: q.bid, ask: q.ask, generatedAt: q.generatedAt,
        dailyVolume: q.dailyVolume, dailyHigh: q.dailyHigh, dailyLow: q.dailyLow,
        isTradingHalt: q.isTradingHalt, unreliable,
      };
    }

    let premium = null, tvl = null, exec = null;
    if (dex && ref && ref.price > 0 && !ref.unreliable) {
      premium = ((dex.price - ref.price) / ref.price) * 100;
      tvl = dex.tvl > 0 ? dex.tvl : null;
      if (tvl) {
        // Prism-style execution premium: estimated effective premium after
        // price impact at a given USD fill size on a constant-product model.
        // impact ≈ fillSize / TVL (one-sided depth ≈ total TVL); clearly an estimate.
        // If impact > 50% the pool is effectively illiquid at that size -> null.
        exec = {};
        [100, 1000, 10000].forEach((sz) => {
          const impact = (sz / tvl) * 100;
          exec[sz] = impact > 50 ? null : premium - impact;
        });
      }
    }

    rows.push({
      symbol: t.symbol, name: t.name, address: t.address, multiplier: parseFloat(t.multiplier) || 1,
      type: /ETF|SPY|QQQ|ARK|VTI|IWM|GLD|SLV|TQQQ|SQQQ|SOXL|SOXX|XL|VOO|DIA|SMH|IBB|EWZ|EEM|EFA/.test(t.symbol) ? 'ETF' : 'STOCK',
      ref, dex: dex ? { price: dex.price, pool: dex.pool, fee: dex.fee, quote: dex.quote, tvl: dex.tvl } : null,
      premium, tvl, exec,
    });
  }

  const ms = marketStatus();
  const withRef = rows.filter((r) => r.ref);
  const withDex = rows.filter((r) => r.dex);
  const withPrem = rows.filter((r) => r.premium !== null);
  const absPrem = withPrem.map((r) => Math.abs(r.premium));
  const anomaly = rows.filter((r) => r.premium !== null && ((ms.offHours && Math.abs(r.premium) > 2) || Math.abs(r.premium) > 10));
  const median = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  return {
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - t0,
    chain: { id: 4663, name: 'Robinhood Chain', block: blockNum ? Number(blockNum) : null, rpc: RPC_URL },
    market: ms,
    ethUsd, ethPoolEvidence,
    summary: {
      total: rows.length, withRef: withRef.length, withDex: withDex.length, withPrem: withPrem.length,
      anomalyCount: anomaly.length, medianAbsPremiumPct: median(absPrem),
      feedCount: Object.keys(feeds).length, poolCount: Object.keys(pools.poolInfo).length,
    },
    tokens: rows,
  };
}

module.exports = { buildSnapshot, marketStatus };
