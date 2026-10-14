// Compile AnchorRegistry.sol with solc (wasm), emit build/AnchorRegistry.json {abi, bytecode}
const fs = require('fs');
const path = require('path');
const solc = require('solc');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'contracts', 'AnchorRegistry.sol');
const OUT = path.join(ROOT, 'build', 'AnchorRegistry.json');

const source = fs.readFileSync(SRC, 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'AnchorRegistry.sol': { content: source } },
  settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter((e) => e.severity === 'error');
if (errors.length) {
  for (const e of errors) console.error('[compile]', e.formattedMessage);
  process.exit(1);
}

const c = output.contracts['AnchorRegistry.sol'].AnchorRegistry;
if (!c || !c.evm || !c.evm.bytecode || !c.evm.bytecode.object) {
  console.error('[compile] no contract output');
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }, null, 2));
console.log('[compile] ok ->', OUT, '| abi items:', c.abi.length, '| bytecode bytes:', c.evm.bytecode.object.length / 2);
