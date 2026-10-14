// Optional SQLite upload step for CI (index-incremental.yml).
// Uploads the local HoodScope database to object storage.
// Configure DB_UPLOAD_URL (a pre-signed PUT URL to R2/S3) to enable;
// otherwise this script exits 0 with a warning so the workflow stays green.
'use strict';
const fs = require('fs');
const path = require('path');

const DB = process.env.HOODSCOPE_DB || path.join(__dirname, '..', 'data', 'hoodscope.db');
const URL = process.env.DB_UPLOAD_URL;

async function main() {
  if (!URL) {
    console.log('::warning::DB upload skipped — set DB_UPLOAD_URL (pre-signed PUT URL) to enable');
    return;
  }
  if (!fs.existsSync(DB)) {
    console.log('::warning::no database at ' + DB + ' — upload skipped');
    return;
  }
  const buf = fs.readFileSync(DB);
  const r = await fetch(URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', 'x-amz-checksum-mode': 'ENABLED' },
    body: buf,
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error('upload failed: ' + r.status + ' ' + (await r.text().catch(() => '')));
  console.log('[upload] db uploaded ' + buf.length + ' bytes');
}

main().catch((e) => {
  console.error('[upload] failed:', e.message);
  process.exit(1);
});
