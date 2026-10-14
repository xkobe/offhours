// HoodScope on-chain event watchers (polling style — fits the 5-min scheduled indexer)
// 1) issuer beacon Upgraded (EIP-1967 beacon proxy) — signals Stock Token contract upgrades
// 2) Pons launchpad graduation polling (hook; address/ABI to be wired when Pons registry is confirmed)
const hc = require('hoodchain');

const BEACON = process.env.ISSUER_BEACON || '0xe10b6f6B275de231345c20D14Ab812db62151b00';

const beaconUpgradedEvent = {
  type: 'event',
  name: 'Upgraded',
  inputs: [{ type: 'address', indexed: true, name: 'implementation' }],
};

function makeClient(rpcUrl) {
  return hc.createHoodClient({ rpcUrl });
}

// Poll for beacon Upgraded events in a block range. Returns [] when nothing found.
async function getBeaconUpgradedEvents({ fromBlock, toBlock, beacon = BEACON, client }) {
  if (fromBlock === undefined || toBlock === undefined) throw new Error('fromBlock/toBlock required');
  const c = client || makeClient(process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com');
  try {
    const logs = await c.public.getLogs({
      address: beacon,
      event: beaconUpgradedEvent,
      fromBlock: BigInt(fromBlock),
      toBlock: BigInt(toBlock),
    });
    return logs.map((l) => ({
      type: 'issuer_beacon_upgraded',
      blockNumber: Number(l.blockNumber),
      txHash: l.transactionHash,
      logIndex: l.logIndex,
      implementation: l.args.implementation,
    }));
  } catch (e) {
    // blockscout-style RPC gateways can reject big log queries; degrade gracefully
    console.error('[events] getBeaconUpgradedEvents failed:', e.message);
    return [];
  }
}

// Pons graduation polling hook.
// Wire when the Pons registry / launchpad addresses are confirmed; until then returns [].
async function pollPonsGraduations({ fromBlock, toBlock, ponsAddress = null, client }) {
  if (!ponsAddress) return [];
  // TODO: replace with the real Pons launchpad ABI + event (e.g. TokenGraduated(token, ...))
  // const logs = await c.public.getLogs({ address: ponsAddress, event: ..., fromBlock, toBlock });
  return [];
}

module.exports = { getBeaconUpgradedEvents, pollPonsGraduations, BEACON };
