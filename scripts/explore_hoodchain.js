// Inspect what hoodchain / hoodkit export
const hoodchain = require('hoodchain');
const hoodkit = require('hoodkit');

console.log('=== hoodchain exports ===');
console.log(Object.keys(hoodchain).sort().join(', '));
console.log('\n=== hoodkit exports ===');
console.log(Object.keys(hoodkit).sort().join(', '));

// Look for registries / feed lists / chain config
const ALL = { ...hoodchain, ...hoodkit };
for (const key of Object.keys(ALL)) {
  const v = ALL[key];
  if (typeof v === 'object' && v !== null) {
    const s = JSON.stringify(v);
    if (s && s.length > 20 && s.length < 4000 && /0x/i.test(s)) {
      console.log('\n---', key, '(object, len', s.length + ')');
      console.log(s.slice(0, 1200));
    }
  }
}
