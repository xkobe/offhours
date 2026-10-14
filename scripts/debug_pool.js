// Debug: why do some pools produce absurd prices? Check getCode for non-existent pools
const hc = require('hoodchain');
const hk = require('hoodkit');

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const client = hc.createHoodClient({ rpcUrl: RPC });
const usdg = hc.MAINNET_ADDRESSES.usdg.toLowerCase();
const weth = hc.MAINNET_ADDRESSES.weth.toLowerCase();
const factory = hc.MAINNET_ADDRESSES.uniswapV3Factory;
const FEE_TIERS = [100, 500, 3000, 10000];
const slot0Abi = [{ type: 'function', name: 'slot0', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint160', name: 'sqrtPriceX96' }, { type: 'int24', name: 'tick' }, { type: 'uint16', name: 'observationIndex' }, { type: 'uint16', name: 'observationCardinality' }, { type: 'uint16', name: 'observationCardinalityNext' }, { type: 'uint8', name: 'feeProtocol' }, { type: 'bool', name: 'unlocked' }] }];
const metaAbi = hk.uniswapV3PoolMetaAbi;
const decAbi = [{ type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }];

async function main() {
  const rhj = require('../rhj_assets.json');
  const amc = rhj.assets.find((a) => a.tokenSymbol === 'AMC');
  const amcAddr = amc.deployments.find((d) => d.chainId === 4663).contractAddress;
  console.log('AMC:', amcAddr);
  const amcL = amcAddr.toLowerCase();

  for (const q of [usdg, weth]) {
    for (const fee of FEE_TIERS) {
      const pool = await client.public.readContract({ address: factory, abi: [{ type: 'function', name: 'getPool', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }], outputs: [{ type: 'address' }] }], functionName: 'getPool', args: [amcAddr, q, fee] });
      const code = await client.public.getCode({ address: pool });
      console.log('\nquote', q.slice(0, 6), 'fee', fee, 'pool', pool, 'hasCode:', code && code.length > 2);
      if (code && code.length > 2) {
        const slot = await client.public.readContract({ address: pool, abi: slot0Abi, functionName: 'slot0' });
        const [t0, t1, pfee] = await client.public.multicall({ contracts: [
          { address: pool, abi: metaAbi, functionName: 'token0' },
          { address: pool, abi: metaAbi, functionName: 'token1' },
          { address: pool, abi: metaAbi, functionName: 'fee' },
        ] });
        const d0r = await client.public.readContract({ address: t0.result, abi: decAbi, functionName: 'decimals' });
        const d1r = await client.public.readContract({ address: t1.result, abi: decAbi, functionName: 'decimals' });
        console.log('slot0 sqrtPriceX96:', slot[0].toString());
        console.log('token0:', t0.result, 'dec', Number(d0r), '| token1:', t1.result, 'dec', Number(d1r), '| fee:', Number(pfee.result));
        const d0 = Number(d0r), d1 = Number(d1r);
        const sq = Number(slot[0]) / 2 ** 96;
        const P = sq * sq * 10 ** (d0 - d1);
        console.log('P (price of token0 in token1):', P);
      }
    }
  }
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
