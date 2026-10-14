// Smoke test: can we require the x402 SDK pieces we need?
'use strict';
const results = {};
function tryReq(name, path) {
  try { const m = require(path); results[name] = 'OK ' + (Object.keys(m).slice(0, 8).join(', ')); }
  catch (e) { results[name] = 'FAIL ' + e.message.slice(0, 120); }
}
tryReq('core/client', '@x402/core/client');
tryReq('evm/exact/client/register', '@x402/evm/exact/client/register');
tryReq('evm/exact/server', '@x402/evm/exact/server');
tryReq('evm/signer', '@x402/evm');
tryReq('viem', 'viem');
tryReq('viem/accounts', 'viem/accounts');
tryReq('zod', 'zod');
console.log(JSON.stringify(results, null, 2));
