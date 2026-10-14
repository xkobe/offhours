$ErrorActionPreference = 'Stop'
$p = 'C:\Users\小可爱\Doubao\chats\2026-09-16\new-chat\hoodscope\public\app.js'
$t = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)

# 1) hook switchView for 'pons'
$svOld = "    if (v === 'history') fillTMSymbols();"
$svNew = "    if (v === 'history') fillTMSymbols();`n    if (v === 'pons') loadPons();"
if ($t.Contains($svOld)) { $t = $t.Replace($svOld, $svNew) } else { Write-Output 'SWITCHVIEW_ANCHOR_MISSING'; exit 1 }

# 2) inject Pons rendering block before boot
$anchor = "  // ---------- boot ----------"
$ia = $t.IndexOf($anchor)
if ($ia -lt 0) { Write-Output 'BOOT_ANCHOR_MISSING'; exit 1 }

$block = @'
  // ---------- Pons launchpad monitor ----------
  var ponsState = { bucket: 'day' };
  function loadPons() {
    var box = $('ponsCoverage');
    box.innerHTML = '<div class="empty-body">Loading on-chain graduation data…</div>';
    fetch('/api/pons/stats?period=' + ponsState.bucket).then(function (r) { return r.json(); })
      .then(function (s) {
        if (!s.available) { box.innerHTML = '<div class="empty-body">' + esc(s.reason || 'Pons index not ready yet — backfill still running.') + '</div>'; return; }
        renderPonsStats(s);
        $('ponsNote').innerHTML = 'Bucket: <b>' + s.bucket + '</b> · indexed to block <b>' + (s.backfillTo ? s.backfillTo.toLocaleString('en-US') : '—') + '</b>';
        loadPonsNear();
        renderPonsRwa(s.recentStock || [], s.rwaSymbols || {});
      })
      .catch(function (err) { box.innerHTML = '<div class="empty-body">Failed: ' + esc(err.message) + '</div>'; });
  }
  function renderPonsStats(s) {
    $('ponsTotal').textContent = s.total.toLocaleString('en-US');
    $('ponsGrad').textContent = s.graduated.toLocaleString('en-US');
    $('ponsRate').textContent = s.rate + '%';
    $('ponsStock').textContent = s.stockQuoted.toLocaleString('en-US');
    if (!window.echarts) { $('ponsChart').textContent = 'Chart lib unavailable'; return; }
    var el = $('ponsChart');
    el.innerHTML = '';
    var ch = echarts.init(el);
    var keys = s.trend.map(function (t) { return t.key; });
    ch.setOption({
      grid: { left: 56, right: 56, top: 30, bottom: 28 },
      legend: { data: ['Launches', 'Graduated', 'Rate %'], top: 0, textStyle: { color: '#64748B', fontSize: 11 } },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: keys, axisLabel: { color: '#64748B', fontSize: 9, rotate: keys.length > 14 ? 40 : 0 }, axisLine: { lineStyle: { color: '#E6E8EC' } } },
      yAxis: [
        { type: 'value', name: 'count', axisLabel: { color: '#64748B', fontSize: 10 }, splitLine: { lineStyle: { color: '#EEF0F3' } } },
        { type: 'value', name: 'rate %', max: 100, axisLabel: { color: '#94A3B8', fontSize: 10 }, splitLine: { show: false } },
      ],
      series: [
        { name: 'Launches', type: 'bar', data: s.trend.map(function (t) { return t.launches; }), itemStyle: { color: '#1D4ED8', opacity: 0.85 }, barMaxWidth: 22 },
        { name: 'Graduated', type: 'bar', data: s.trend.map(function (t) { return t.graduated; }), itemStyle: { color: '#059669', opacity: 0.85 }, barMaxWidth: 22 },
        { name: 'Rate %', type: 'line', yAxisIndex: 1, data: s.trend.map(function (t) { return t.rate; }), lineStyle: { width: 2, color: '#F59E0B' }, itemStyle: { color: '#F59E0B' }, symbolSize: 5 },
      ],
    });
  }
  function loadPonsNear() {
    fetch('/api/pons/near?limit=15&days=14').then(function (r) { return r.json(); })
      .then(function (n) {
        var box = $('ponsNear');
        if (!n.available) { box.innerHTML = '<div class="empty-body">' + esc(n.reason || 'unavailable') + '</div>'; return; }
        if (!n.list.length) { box.innerHTML = '<div class="empty-body">No ungraduated launches in the last ' + n.days + ' days with meaningful progress.</div>'; return; }
        box.innerHTML = n.list.map(function (p) {
          var pct = Math.round(p.progress * 100);
          var bar = '<div class="prog"><div class="prog-fill" style="width:' + pct + '%"></div></div>';
          var grad = p.graduated ? '<span class="pill ok">GRADUATED</span>' : '<span class="pill">curve</span>';
          return '<div class="pons-row">' +
            '<span class="ev-sym">' + esc(p.token.slice(0, 10)) + '…</span>' +
            '<span>' + esc(p.pairSymbol) + ' quoted</span>' +
            '<span class="prog-wrap">' + bar + '<b>' + pct + '%</b></span>' +
            '<span>' + fmtEth(p.threshold) + ' ETH threshold</span>' +
            grad + '</div>';
        }).join('');
      })
      .catch(function (err) { $('ponsNear').innerHTML = '<div class="empty-body">Failed: ' + esc(err.message) + '</div>'; });
  }
  function renderPonsRwa(recent, symbols) {
    var box = $('ponsRwa');
    if (!recent.length) { box.innerHTML = '<div class="empty-body">No stock/ETF-quoted launches yet.</div>'; return; }
    var top = Object.entries(symbols).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 6)
      .map(function (x) { return '<span class="pill">' + esc(x[0]) + ' ×' + x[1] + '</span>'; }).join(' ');
    var rows = recent.map(function (l) {
      return '<div class="pons-row">' +
        '<span class="ev-sym">' + esc(l.pairSymbol) + '</span>' +
        '<span>' + esc(l.token.slice(0, 10)) + '…</span>' +
        '<span>threshold ' + fmtEth(l.threshold) + '</span>' +
        '<span>' + FMT.time(new Date(l.launchedAt * 1000).toISOString()) + '</span>' +
        (l.graduated ? '<span class="pill ok">GRADUATED</span>' : '<span class="pill">live</span>') + '</div>';
    }).join('');
    box.innerHTML = '<div class="pons-syms">' + top + '</div>' + rows;
  }
  function fmtEth(threshold) {
    try {
      var v = Number(BigInt(threshold) / 10n ** 18n * 10n) / 10;
      return v % 1 === 0 ? String(v) : v.toFixed(1);
    } catch (e) { return threshold; }
  }

  $('ponsBucketChips').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    Array.prototype.forEach.call(this.querySelectorAll('.chip'), function (c) { c.classList.toggle('active', c === chip); });
    ponsState.bucket = chip.dataset.bucket;
    loadPons();
  });

'@

$t = $t.Substring(0, $ia) + $block + $t.Substring($ia)
[IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
Write-Output 'APPJS_PONS_INJECTED'
