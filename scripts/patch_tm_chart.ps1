$ErrorActionPreference = 'Stop'
$p = 'C:\Users\小可爱\Doubao\chats\2026-09-16\new-chat\hoodscope\public\app.js'
$t = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)

# ---- replace tmDrawChart ----
$startA = '  function tmDrawChart() {'
$endA = '  function tmUpdateReadout() {'
$ia = $t.IndexOf($startA)
$ja = $t.IndexOf($endA)
if ($ia -lt 0 -or $ja -lt 0 -or $ja -le $ia) { Write-Output 'DRAWCHART_ANCHOR_MISSING'; exit 1 }

$newChart = @'
  function tmDrawChart() {
    if (!window.echarts) { $('tmChart').textContent = 'Chart lib unavailable'; return; }
    var el = $('tmChart');
    el.innerHTML = '';
    tmChart = echarts.init(el);
    var times = tm.rows.map(function (r) { return FMT.time(r.generated_at); });
    var refs = tm.rows.map(function (r) { return (r.ref_price === null || r.ref_price === undefined) ? null : +r.ref_price.toFixed(4); });
    var dexs = tm.rows.map(function (r) { return (r.dex_price === null || r.dex_price === undefined) ? null : +r.dex_price.toFixed(4); });
    var prems = tm.rows.map(function (r) { return r.premium === null ? null : +r.premium.toFixed(3); });
    tmChart.setOption({
      grid: { left: 78, right: 78, top: 26, bottom: 34 },
      legend: { data: ['Ref', 'DEX', 'Premium'], top: 0, textStyle: { color: '#64748B', fontSize: 11 } },
      tooltip: { trigger: 'axis', formatter: function (ps) {
        var out = [];
        ps.forEach(function (p) { out.push(p.marker + ' ' + p.seriesName + ': <b>' + p.value + '</b>'); });
        return out.join('<br>');
      } },
      xAxis: { type: 'category', data: times, axisLabel: { color: '#64748B', fontSize: 10 }, axisLine: { lineStyle: { color: '#E6E8EC' } } },
      yAxis: [
        { type: 'value', name: '$ price', axisLabel: { color: '#64748B', fontSize: 10 }, splitLine: { lineStyle: { color: '#EEF0F3' } } },
        { type: 'value', name: 'premium %', axisLabel: { color: '#94A3B8', fontSize: 10 }, splitLine: { show: false } },
      ],
      series: [
        { name: 'Ref', type: 'line', data: refs, symbolSize: 6, lineStyle: { width: 2, color: '#1D4ED8' }, itemStyle: { color: '#1D4ED8' }, connectNulls: true },
        { name: 'DEX', type: 'line', data: dexs, symbolSize: 6, lineStyle: { width: 2, color: '#F59E0B' }, itemStyle: { color: '#F59E0B' }, connectNulls: true },
        { name: 'Premium', type: 'line', yAxisIndex: 1, data: prems, symbolSize: 4, lineStyle: { width: 1.5, color: '#94A3B8', type: 'dashed' }, itemStyle: { color: '#94A3B8' }, connectNulls: true,
          markLine: { silent: true, symbol: 'none', lineStyle: { type: 'dotted', color: '#C0C6CF' }, data: [{ yAxis: 0 }] } },
      ],
    });
  }

'@

$t = $t.Substring(0, $ia) + $newChart + $t.Substring($ja)

# ---- replace tmRenderStats ----
$startB = '  function tmRenderStats(rows, evRows) {'
$endB = '  function stopTmPlay() {'
$ib = $t.IndexOf($startB)
$jb = $t.IndexOf($endB)
if ($ib -lt 0 -or $jb -lt 0 -or $jb -le $ib) { Write-Output 'RENDERSTATS_ANCHOR_MISSING'; exit 1 }

$newStats = @'
  function tmRenderStats(rows, evRows) {
    // Max |peak| always derivable from the snapshot series; event-based stats need events.
    var snapPeaks = rows.map(function (r) { return r.premium === null ? null : Math.abs(r.premium); }).filter(function (v) { return v !== null; });
    var durs = evRows.filter(function (e) { return e.ended_at; }).map(function (e) { return (new Date(e.ended_at) - new Date(e.started_at)) / 60000; });
    var off = evRows.filter(function (e) { return e.off_hours; }).length;
    var avg = function (a) { if (!a.length) return null; return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
    var cards = [
      ['Snapshots', rows.length],
      ['Threshold events', evRows.length],
      ['Max |peak|', snapPeaks.length ? tmFmtPct(Math.max.apply(null, snapPeaks)) : '—'],
      ['Avg event length', evRows.length ? Math.round(avg(durs)) + ' min' : 'n/a'],
      ['Off-hours share', evRows.length ? Math.round((off / evRows.length) * 100) + '%' : 'n/a'],
    ];
    $('tmStats').innerHTML = cards.map(function (c) {
      return '<div class="tm-stat"><div class="k">' + c[0] + '</div><div class="v">' + c[1] + '</div></div>';
    }).join('');
    if (!evRows.length) {
      $('tmStats').insertAdjacentHTML('beforeend', '<div class="tm-ev" style="grid-column:1/-1">No threshold events yet — max |peak| above is from the snapshot series.</div>');
    }
  }

'@

$t = $t.Substring(0, $ib) + $newStats + $t.Substring($jb)

[IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
Write-Output 'TM_CHART_STATS_PATCHED'
