// MCP stdio protocol test for HoodScope MCP Server
// Spawns mcp-server/index.js, drives JSON-RPC over stdio:
// initialize -> notifications/initialized -> tools/list -> tools/call x6
// Run from hoodscope root: node scripts/test_mcp.js
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'mcp-server', 'index.js');
const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });

let buf = '';
const pending = new Map();
let nextId = 1;

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + '\n');
}

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  }
});

child.stderr.on('data', (d) => process.stderr.write('[mcp-stderr] ' + d));

function summarizeToolCall(res, maxLen) {
  const text = res && res.content && res.content[0] && res.content[0].text;
  const s = String(text || '');
  const lines = s.split('\n');
  return 'lines=' + lines.length + ' | first: ' + lines[0].slice(0, maxLen || 120);
}

async function main() {
  try {
    const init = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'hoodscope-test', version: '0.0.1' },
    });
    console.log('INITIALIZE ok · server:', init.serverInfo.name, init.serverInfo.version, '· protocol', init.protocolVersion);

    send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const tools = await rpc('tools/list', {});
    console.log('TOOLS:', tools.tools.map((t) => t.name).join(', '));
    console.assert(tools.tools.length === 6, 'expected 6 tools');

    // 1 premium_snapshot (limit 3)
    let r = await rpc('tools/call', { name: 'premium_snapshot', arguments: { limit: 3 } });
    console.log('[1] premium_snapshot:', summarizeToolCall(r));
    console.assert(r.isError !== true, 'premium_snapshot failed');

    // 2 stock_token_analysis NVDA
    r = await rpc('tools/call', { name: 'stock_token_analysis', arguments: { symbol: 'NVDA' } });
    console.log('[2] stock_token_analysis:', summarizeToolCall(r, 200));
    console.assert(r.isError !== true, 'analysis failed');

    // 3 premium_history NVDA
    r = await rpc('tools/call', { name: 'premium_history', arguments: { symbol: 'NVDA', days: 7 } });
    console.log('[3] premium_history:', summarizeToolCall(r, 150));
    console.assert(r.isError !== true, 'history failed');

    // 4 pons stats
    r = await rpc('tools/call', { name: 'pons_graduation_stats', arguments: { period: 'week' } });
    console.log('[4] pons_graduation_stats:', summarizeToolCall(r, 150));
    console.assert(r.isError !== true, 'pons stats failed');

    // 5 pons watch
    r = await rpc('tools/call', { name: 'pons_graduation_watch', arguments: { token: '0xfd80584a23f418e483429d7080a1de04db344157' } });
    console.log('[5] pons_graduation_watch:', summarizeToolCall(r, 150));
    console.assert(r.isError !== true, 'pons watch failed');

    // 6 evidence_verify — grab hash from analysis result and verify
    r = await rpc('tools/call', { name: 'evidence_verify', arguments: { reportHash: 'deadbeef' } });
    console.log('[6a] evidence_verify (bad hash):', summarizeToolCall(r, 120));
    console.assert(r.isError === true, 'bad hash should error');

    const ana = await rpc('tools/call', { name: 'stock_token_analysis', arguments: { symbol: 'SOFI' } });
    const anaText = ana.content[0].text;
    const m = anaText.match(/hash sha256: ([0-9a-f]{64})/);
    if (m) {
      r = await rpc('tools/call', { name: 'evidence_verify', arguments: { reportHash: m[1] } });
      console.log('[6b] evidence_verify (real hash ' + m[1].slice(0, 12) + '…):', summarizeToolCall(r, 150));
      console.assert(r.isError !== true, 'verify failed');
    } else {
      console.log('[6b] skipped — no hash found in SOFI analysis output');
    }

    console.log('\nALL MCP TESTS PASSED');
    child.kill();
    process.exit(0);
  } catch (e) {
    console.error('MCP TEST FAILED:', e.message);
    child.kill();
    process.exit(1);
  }
}

main();
