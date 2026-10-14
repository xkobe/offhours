// x402 payment middleware for HoodScope MCP tools
// Implements the x402 pay-per-call flow on Robinhood Chain (eip155:4663),
// settled in USDG (6 decimals) via EIP-3009 TransferWithAuthorization —
// payer signs off-chain (gasless), a facilitator broadcasts settlement.
//
// Modes:
//   dev    (default) — signs with a deterministic dev signer, NO on-chain settlement.
//                      Receipts are marked `settlement: dev_only`.
//   live   — requires X402_SIGNER_PRIVATE_KEY + X402_PAYEE + X402_FACILITATOR_URL;
//                      full challenge -> sign -> verify -> settle round-trip.
'use strict';

const { x402Client } = require('@x402/core/client');
const { registerExactEvmScheme } = require('@x402/evm/exact/client');
const { toClientEvmSigner } = require('@x402/evm');
const { privateKeyToAccount } = require('viem/accounts');
const { createPublicClient, http } = require('viem');

const NETWORK = 'eip155:4663';
const CHAIN_ID = 4663;
const RPC = process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
const USDG = process.env.X402_USDG || '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const USDG_DECIMALS = 6;

// Deterministic dev signer (never holds funds; dev-only receipts).
const DEV_KEY = '0x' + 'ab'.repeat(32);

// PRD §3.3 pricing table (USD, settled as USDG on Robinhood Chain).
const PRICING = {
  premium_snapshot: 0.01,
  stock_token_analysis: 0.05,
  premium_history: 0.03,
  pons_graduation_stats: 0.02,
  pons_graduation_watch: 0.01,
  evidence_verify: 0.01,
};

function isLive() {
  return !!(process.env.X402_SIGNER_PRIVATE_KEY && process.env.X402_PAYEE);
}

function devAccount() {
  return privateKeyToAccount(DEV_KEY);
}

function signerFor() {
  if (isLive()) return privateKeyToAccount(process.env.X402_SIGNER_PRIVATE_KEY);
  return devAccount();
}

function payee() {
  return (process.env.X402_PAYEE || devAccount().address).toLowerCase();
}

function usdgAmount(usd) {
  // USDG is 6 decimals, USDG ≈ $1
  return String(Math.round(usd * 10 ** USDG_DECIMALS));
}

// EIP-712 domain for EIP-3009 signing on USDG (Global Dollar).
// name/symbol/decimals verified on-chain; contract has no version() so the
// standard "1" is used (same convention as USDC & co). chainId from eip155:4663.
const USDG_NAME = process.env.X402_USDG_NAME || 'Global Dollar';
const USDG_VERSION = process.env.X402_USDG_VERSION || '1';

// Build an x402 PaymentRequirements entry for a tool.
function buildRequirements(tool) {
  const price = PRICING[tool];
  if (price === undefined) throw new Error('no price defined for tool: ' + tool);
  return {
    scheme: 'exact',
    network: NETWORK,
    asset: USDG,
    amount: usdgAmount(price),
    payTo: payee(),
    maxTimeoutSeconds: 300,
    extra: {
      service: 'hoodscope',
      tool,
      decimals: USDG_DECIMALS,
      name: USDG_NAME,
      version: USDG_VERSION,
      note: 'Settled in USDG on Robinhood Chain; payer is gasless (EIP-3009 TransferWithAuthorization).',
    },
  };
}

function resourceInfo(tool) {
  return {
    url: 'hoodscope://mcp/' + tool,
    description: 'HoodScope Stock Token analytics — ' + tool,
    mimeType: 'text/plain',
    serviceName: 'HoodScope MCP',
  };
}

// Full sign flow: requirements -> PaymentRequired -> signed PaymentPayload.
async function signPayment(tool) {
  const account = signerFor();
  const publicClient = createPublicClient({ transport: http(RPC) });
  // Composed signer: local account + public client, so the scheme can read the
  // USDG EIP-712 domain (name/version) and EIP-3009 nonce from chain.
  const signer = toClientEvmSigner(account, publicClient);
  // USDG is not in the SDK default-asset table; disable spend controls so the
  // service-pinned asset/amount (from the receipt) is honored. In production,
  // replace with setSpendControls({ allowedAssets: { [USDG]: ... } }) for caps.
  const client = new x402Client();
  client.setSpendControls(false);
  registerExactEvmScheme(client, { signer });
  const paymentRequired = {
    x402Version: 2,
    resource: resourceInfo(tool),
    accepts: [buildRequirements(tool)],
  };
  const payload = await client.createPaymentPayload(paymentRequired);
  return { payload, account };
}

// Public entry: returns a receipt for tool, or a not-configured status.
async function charge(tool) {
  if (!PRICING[tool]) return { status: 'error', error: 'unknown tool: ' + tool };
  try {
    const { payload, account } = await signPayment(tool);
    const req = payload.accepted;
    const p = payload.payload || {};
    const receipt = {
      status: 'ok',
      mode: isLive() ? 'live' : 'dev',
      tool,
      price: '$' + PRICING[tool].toFixed(2),
      network: NETWORK,
      asset: USDG,
      amount: req.amount,
      payTo: req.payTo,
      payer: account.address,
      x402Version: payload.x402Version,
      scheme: req.scheme,
      nonce: (p.authorization && p.authorization.nonce) || (p.nonce !== undefined ? String(p.nonce) : undefined),
      signature: p.signature || undefined,
      settlement: isLive() ? 'pending_facilitator' : 'dev_only',
      facilitator: process.env.X402_FACILITATOR_URL || null,
    };
    return receipt;
  } catch (e) {
    return { status: 'error', error: 'x402 sign failed: ' + (e && e.message ? e.message : String(e)) };
  }
}

// Short single-line receipt for embedding in MCP tool output.
async function chargeLine(tool) {
  const r = await charge(tool);
  if (r.status !== 'ok') {
    return 'X402: ' + (r.error || 'unavailable');
  }
  const parts = [
    'X402 paid ' + r.price + ' (USDG @ eip155:4663)',
    'payer ' + r.payer.slice(0, 10) + '…',
    '→ ' + r.payTo.slice(0, 10) + '…',
    'nonce ' + (r.nonce !== undefined ? r.nonce : '—'),
    'mode ' + r.mode,
    'settlement ' + r.settlement,
  ];
  if (r.mode === 'dev') parts.push('(dev signer — no funds moved; set X402_PAYEE + X402_SIGNER_PRIVATE_KEY to go live)');
  return parts.join(' · ');
}

module.exports = { PRICING, charge, chargeLine, buildRequirements, isLive, payee, USDG, NETWORK };
