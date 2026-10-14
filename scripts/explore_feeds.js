// Extract Chainlink RDD url for Robinhood from the docs page, then fetch the feed registry
const fs = require('fs');
const path = require('path');

async function main() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'cl.html'), 'utf8');
  const re = /"rddUrl":\[0,"([^"]+)"/g;
  const urls = [];
  let m;
  while ((m = re.exec(html)) !== null) urls.push(m[1]);
  console.log('total rdd urls:', urls.length);
  const robinhood = urls.filter((u) => u.toLowerCase().includes('robinhood'));
  console.log('robinhood rdd urls:', robinhood.join('\n') || '(none)');

  // Try the most likely mainnet URL
  const candidates = [
    'https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json',
    ...robinhood,
  ];
  for (const url of candidates) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const text = await r.text();
      console.log('FETCH', r.status, url.slice(0, 100), 'bytes:', text.length);
      if (r.ok && text.length > 100) {
        fs.writeFileSync(path.join(__dirname, '..', 'chainlink_feeds.json'), text);
        console.log('saved chainlink_feeds.json');
        const j = JSON.parse(text);
        if (Array.isArray(j)) {
          console.log('feeds count:', j.length);
          const sample = j.slice(0, 5).map((f) => ({
            name: f.name,
            pair: f.pair,
            proxy: f.proxyAddress,
            decimals: f.decimals,
            heartbeat: f.heartbeat,
          }));
          console.log(JSON.stringify(sample, null, 1).slice(0, 1500));
        } else {
          console.log('keys:', Object.keys(j).slice(0, 20));
        }
        break;
      }
    } catch (e) {
      console.log('ERR', url.slice(0, 90), e.message);
    }
  }
}

main();
