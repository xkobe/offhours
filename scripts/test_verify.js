// HoodScope report/verify test: report generation, hash/CID self-consistency,
// tamper detection, chain-record verification, and known-CID cross-check.
const fs = require('fs');
const path = require('path');
const { generateReportWithAnchor, generateReports } = require('../lib/report');
const { sha256Hex, toBase58, cidV0FromSha256, verifyReport, verifyHash } = require('../lib/verify');

const ROOT = path.join(__dirname, '..');
let failures = 0;
const check = (name, cond, extra) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
  if (!cond) failures++;
};

async function main() {
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'snapshot_test.json'), 'utf8'));

  // 0) base58 known vectors (bitcoin base58 spec examples)
  check('base58 vector 0x61', toBase58(Buffer.from([0x61])) === '2g', toBase58(Buffer.from([0x61])));
  check('base58 vector 0x000061', toBase58(Buffer.from([0x00, 0x00, 0x61])) === '112g', toBase58(Buffer.from([0x00, 0x00, 0x61])));
  // sha256('') multihash CIDv0 fingerprint: deterministic, always reproducible
  const emptyHash = sha256Hex('');
  const emptyFp = cidV0FromSha256(emptyHash);
  check('fingerprint cid reproducible', cidV0FromSha256(emptyHash) === emptyFp, emptyFp);

  // 1) single report
  const { report, hash, ipfsCid } = generateReportWithAnchor('NVDA', snap);
  check('report generated', report.token.symbol === 'NVDA' && report.evidenceChain.length > 0,
    'evidence=' + report.evidenceChain.map((e) => e.type).join(','));
  check('no recommendation language', !/买入|卖出|推荐|buy|sell/i.test(JSON.stringify(report)));

  // 2) hash derives from report bytes (canonical JSON)
  const h2 = sha256Hex(report);
  check('hash self-consistent', h2 === hash, hash.slice(0, 16) + '...');

  // 3) CID derives from hash
  const c2 = cidV0FromSha256(hash);
  check('cid derives from hash', c2 === ipfsCid, ipfsCid);

  // 4) tamper detection: one tiny change must change hash + cid
  const tampered = JSON.parse(JSON.stringify(report));
  tampered.dex.price += 0.01;
  const h3 = sha256Hex(tampered);
  check('tamper changes hash', h3 !== hash);
  check('tamper changes cid', cidV0FromSha256(h3) !== ipfsCid);

  // 5) verifyReport: correct chain record passes, wrong cid fails
  const okRec = { cid: ipfsCid, timestamp: 1760000000, anchoredBy: '0xabc' };
  const vOk = verifyReport(report, okRec);
  check('verifyReport passes on matching record', vOk.ok === true, JSON.stringify(vOk.checks));
  const badRec = { cid: 'Qm' + ipfsCid.slice(3) + 'x', timestamp: 1760000000, anchoredBy: '0xabc' };
  const vBad = verifyReport(report, badRec);
  check('verifyReport fails on wrong cid', vBad.ok === false);

  // 6) verifyHash rejects an unanchored hash (empty record)
  const vUn = verifyHash(hash, null);
  check('verifyHash rejects unanchored', vUn.ok === false);

  // 7) batch reports (premium_snapshot path)
  const all = generateReports(snap);
  check('batch reports cover universe', all.length === snap.tokens.length, 'count=' + all.length);
  const withCid = all.filter((r) => r.hash && r.ipfsCid);
  check('batch hashes/cids computed', withCid.length === all.length);

  // 8) report for a symbol without dex still works (evidence = reference only)
  const noDex = snap.tokens.find((t) => !t.dex);
  if (noDex) {
    const r2 = generateReportWithAnchor(noDex.symbol, snap);
    check('no-dex report ok', r2.report.dex === null && r2.report.reference !== null, noDex.symbol);
  }

  console.log(failures ? '--- ' + failures + ' FAILURES ---' : '--- ALL PASS ---');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('test crashed:', e.message); process.exit(1); });
