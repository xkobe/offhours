$ErrorActionPreference = 'Stop'
$p = 'C:\Users\小可爱\Doubao\chats\2026-09-16\new-chat\hoodscope\public\app.js'
$t = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)

# A) switchView: history case
$oldA = "    if (v === 'watchlist') renderWatchlist();`n    if (v === 'anomalies') renderAnomalies();`n  }"
$newA = "    if (v === 'watchlist') renderWatchlist();`n    if (v === 'anomalies') renderAnomalies();`n    if (v === 'history') fillTMSymbols();`n  }"
if (-not $t.Contains($oldA)) { Write-Output 'A_NOT_FOUND'; exit 1 }
$t = $t.Replace($oldA, $newA)

# B) insert Time Machine block before boot section
$anchor = '  // ---------- boot ----------'
$tm = @'
  // ---------- time machine (history replay) ----------
  var tm = { rows: [], idx: 0, timer: null };
  var tmChart = null;

  function tmFmtPct(v) { if (v === null || v === undefined || !isFinite(v)) return '—'; return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%'; }
  function durFmt(ms) { if (!isFinite(ms) || ms < 0) return '—'; var m = Math.round(ms / 60000); if (m < 60) return m + ' min'; var h = Math.floor(m / 60); return h + 'h ' + (m % 60) + 'm'; }

  function fillTMSymbols() {
    var dl = $('tmSymbols');
    if (!dl || !state.snap) return;
    dl.innerHTML = state.snap.tokens.map(function (r) { return '<option value="' + esc(r.symbol) + '">'; }).join('');
  }

  function tmLoad() {
    var sym = ($('tmSymbol').value || '').trim().toUpperCase();
    if (!sym) return;
    stopTmPlay();
    $('tmLoad').disabled = true;
    $('tmReadout').hidden = true;
    $('tmStats').innerHTML = '';
    $('tmEvents').innerHTML = '';
    $('tmEmpty').hidden = true;
    Promise.all([
      fetch('/api/history?symbol=' + encodeURIComponent(sym) + '&days=30').then(function (r) { return r.json(); }),
      fetch('/api/events?symbol=' + encodeURIComponent(sym) + '&days=30').then(function (r) { return r.json(); }),
    ]).then(function (res) {
      var h = res[0], ev = res[1];
      if (!h.rows || !h.rows.length) { $('tmEmpty').hidden = false; $('tmLoad').disabled = false; return; }
      tm.rows = h.rows;
      tm.idx = h.rows.length - 1;
      tmDrawChart();
      tmUpdateReadout();
      tmRenderEvents(ev.rows || []);
      tmRenderStats(h.rows, ev.rows || []);
      $('tmSlider').max = h.rows.length - 1;
      $('tmSlider').value = tm.idx;
      $('tmSlider').disabled = false;
      $('tmPlay').disabled = false;
      $('tmLoad').disabled = false;
    }).catch(function (err) { showError('Time Machine load failed: ' + err.message); $('tmLoad').disabled = false; });
  }

  function tmDrawChart() {
    if (!window.echarts) { $('tmChart').textContent = 'Chart lib unavailable'; return; }
    var el = $('tmChart');
    el.innerHTML = '';
    tmChart = echarts.init(el);
    var times = tm.rows.map(function (r) { return FMT.time(r.generated_at); });
    var vals = tm.rows.map(function (r) { return r.premium === null ? null : +r.premium.toFixed(3); });
    tmChart.setOption({
      grid: { left: 64, right: 24, top: 18, bottom: 34 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: times, axisLabel: { color: '#64748B', fontSize: 10 }, axisLine: { lineStyle: { color: '#E6E8EC' } } },
      yAxis: { type: 'value', name: 'premium %', axisLabel: { color: '#64748B', fontSize: 10 }, splitLine: { lineStyle: { color: '#EEF0F3' } } },
      series: [{
        type: 'line', data: vals, smooth: true, symbolSize: 6,
        lineStyle: { width: 2, color: '#1D4ED8' }, itemStyle: { color: '#1D4ED8' },
        markLine: { silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: '#94A3B8' }, data: [{ yAxis: 0 }] },
        markPoint: { symbol: 'pin', symbolSize: 34, itemStyle: { color: '#F59E0B' }, data: [{ type: 'max', name: 'peak' }] },
      }],
    });
  }

  function tmUpdateReadout() {
    var r = tm.rows[tm.idx];
    if (!r) return;
    $('tmReadout').hidden = false;
    $('tmReadout').innerHTML =
      '<span>Snapshot <b>' + FMT.time(r.generated_at) + '</b></span>' +
      '<span>Ref <b>' + FMT.usd(r.ref_price) + '</b></span>' +
      '<span>DEX <b>' + FMT.usd(r.dex_price) + '</b></span>' +
      '<span>Premium <b>' + tmFmtPct(r.premium) + '</b></span>';
    $('tmTime').textContent = (tm.idx + 1) + ' / ' + tm.rows.length + ' · ' + FMT.time(r.generated_at);
  }

  function tmRenderEvents(rows) {
    var wrap = $('tmEvents');
    wrap.innerHTML = '';
    if (!rows.length) { wrap.innerHTML = '<div class="tm-ev">No threshold events recorded for this token yet.</div>'; return; }
    rows.forEach(function (e) {
      var d = document.createElement('div');
      d.className = 'tm-ev';
      var dir = e.direction === 'above' ? 'PREMIUM' : 'DISCOUNT';
      d.innerHTML =
        '<span class="ev-sym">' + esc(e.symbol) + '</span>' +
        '<span class="ev-dir ' + (e.direction === 'above' ? 'up' : 'down') + '">' + dir + ' >' + e.threshold + '%</span>' +
        '<span>peak ' + tmFmtPct(e.peak_premium) + ' @ ' + FMT.time(e.peak_at) + '</span>' +
        '<span>duration ' + (e.ended_at ? durFmt(new Date(e.ended_at) - new Date(e.started_at)) : 'still active') + '</span>' +
        '<span>' + (e.off_hours ? 'off-hours' : 'market hours') + '</span>';
      wrap.appendChild(d);
    });
  }

  function tmRenderStats(rows, evRows) {
    var peaks = evRows.map(function (e) { return Math.abs(e.peak_premium); });
    var durs = evRows.filter(function (e) { return e.ended_at; }).map(function (e) { return (new Date(e.ended_at) - new Date(e.started_at)) / 60000; });
    var off = evRows.filter(function (e) { return e.off_hours; }).length;
    var avg = function (a) { if (!a.length) return '—'; return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
    var cards = [
      ['Snapshots', rows.length],
      ['Threshold events', evRows.length],
      ['Max |peak|', peaks.length ? tmFmtPct(Math.max.apply(null, peaks)) : '—'],
      ['Avg event length', durs.length ? Math.round(avg(durs)) + ' min' : '—'],
      ['Off-hours share', evRows.length ? Math.round((off / evRows.length) * 100) + '%' : '—'],
    ];
    $('tmStats').innerHTML = cards.map(function (c) {
      return '<div class="tm-stat"><div class="k">' + c[0] + '</div><div class="v">' + c[1] + '</div></div>';
    }).join('');
  }

  function stopTmPlay() {
    if (tm.timer) { clearInterval(tm.timer); tm.timer = null; $('tmPlay').textContent = '▶ Play'; }
  }
  function toggleTmPlay() {
    if (tm.timer) { stopTmPlay(); return; }
    $('tmPlay').textContent = '⏸ Pause';
    tm.timer = setInterval(function () {
      tm.idx = (tm.idx + 1) % tm.rows.length;
      $('tmSlider').value = tm.idx;
      tmUpdateReadout();
    }, 1200);
  }
  $('tmLoad').addEventListener('click', tmLoad);
  $('tmPlay').addEventListener('click', toggleTmPlay);
  $('tmSymbol').addEventListener('keydown', function (e) { if (e.key === 'Enter') tmLoad(); });
  $('tmSlider').addEventListener('input', function () { tm.idx = +this.value; tmUpdateReadout(); });

'@

if (-not $t.Contains($anchor)) { Write-Output 'B_NOT_FOUND'; exit 1 }
$t = $t.Replace($anchor, $tm + $anchor)
[IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
Write-Output 'TM_JS_INSERTED'
