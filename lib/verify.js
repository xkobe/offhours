// HoodScope verification layer (stage 2)
// SHA-256 report hashing, IPFS CID v0 derivation, optional pinning upload, and integrity checks.
const crypto = require('crypto');

// ---- hashing ----
function sha256Hex(obj) {
  const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

// ---- base58 (IPFS multibase) ----
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function toBase58(buffer) {
  let n = 0n;
  for (const byte of buffer) n = n * 256n + BigInt(byte);
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n = n / 58n; }
  for (const byte of buffer) { if (byte === 0) s = '1' + s; else break; }
  return s;
}

// IPFS CID v0 = base58( 0x12 0x20 <sha2-256> ), prefixed 'Qm'
function cidV0FromSha256(hex) {
  const hash = Buffer.from(hex, 'hex');
  if (hash.length !== 32) throw new Error('sha256 hex must decode to 32 bytes');
  const mh = Buffer.concat([Buffer.from([0x12, 0x20]), hash]);
  return 'Qm' + toBase58(mh);
}

// ---- pinning upload (web3.storage-compatible POST /upload) ----
// Env: IPFS_UPLOAD_URL (default https://api.web3.storage/upload), IPFS_TOKEN.
// Without a token configured this runs in dry-run mode: returns the content-fingerprint CID but skips upload.
// IMPORTANT: the CID returned by the pinning service is the real IPFS (UnixFS) CID and is what must be
// anchored on-chain. cidV0FromSha256() is only a deterministic content fingerprint for self-consistency checks.
async function uploadToIpfs(reportOrBytes, opts = {}) {
  const url = opts.url || process.env.IPFS_UPLOAD_URL || 'https://api.web3.storage/upload';
  const token = opts.token || process.env.IPFS_TOKEN;
  const bytes = typeof reportOrBytes === 'string' ? Buffer.from(reportOrBytes, 'utf8') : Buffer.from(JSON.stringify(reportOrBytes), 'utf8');
  const hashHex = sha256Hex(bytes.toString('utf8'));
  const fingerprintCid = cidV0FromSha256(hashHex);
  if (!token) {
    console.warn('[verify] no IPFS_TOKEN configured — dry-run (fingerprint CID computed, not pinned)');
    return { uploaded: false, cid: fingerprintCid, isFingerprint: true, hashHex };
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream' },
    body: bytes,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error('ipfs upload failed: ' + res.status + ' ' + (await res.text()).slice(0, 300));
  const data = await res.json().catch(() => ({}));
  const returnedCid = data.cid || data.CID;
  if (!returnedCid) throw new Error('ipfs upload returned no cid');
  return { uploaded: true, cid: returnedCid, isFingerprint: false, hashHex };
}

// Fetch content from an IPFS gateway by CID and verify its sha256 matches the expected hash.
// Env: IPFS_GATEWAY (default https://ipfs.io/ipfs). Returns { ok, actualHashHex }.
async function verifyAgainstIpfs(cid, expectedHashHex, opts = {}) {
  const gateway = opts.gateway || process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs';
  try {
    const res = await fetch(gateway + '/' + cid, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return { ok: false, reason: 'ipfs fetch ' + res.status };
    const buf = Buffer.from(await res.arrayBuffer());
    const actual = sha256Hex(buf.toString('utf8'));
    return { ok: actual === expectedHashHex, actualHashHex: actual, expectedHashHex };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ---- integrity checks ----
// report: full report object; chainRecord: { cid, timestamp, anchoredBy } from the registry contract.
function verifyReport(report, chainRecord) {
  const localHash = sha256Hex(report);
  const localCid = cidV0FromSha256(localHash);
  const checks = {
    localHashMatches: !report.hash || localHash === report.hash,
    cidDerivesFromHash: !report.ipfsCid || localCid === report.ipfsCid,
    cidAnchoredOnChain: !!chainRecord && chainRecord.cid === localCid,
    anchored: !!chainRecord && !!chainRecord.timestamp,
  };
  const ok = checks.localHashMatches && checks.cidDerivesFromHash && checks.cidAnchoredOnChain && checks.anchored;
  return { ok, checks, localHash, localCid, chainRecord: chainRecord || null };
}

// Verify just a hash against a chain record (used by evidence_verify MCP tool).
function verifyHash(reportHash, chainRecord) {
  const normalized = String(reportHash).toLowerCase().replace(/^0x/, '');
  const cid = cidV0FromSha256(normalized);
  const checks = {
    hashWellFormed: /^[0-9a-f]{64}$/.test(normalized),
    cidAnchoredOnChain: !!chainRecord && chainRecord.cid === cid,
    anchored: !!chainRecord && !!chainRecord.timestamp,
  };
  return { ok: checks.hashWellFormed && checks.cidAnchoredOnChain && checks.anchored, checks, cid };
}

module.exports = { sha256Hex, toBase58, cidV0FromSha256, uploadToIpfs, verifyAgainstIpfs, verifyReport, verifyHash };
