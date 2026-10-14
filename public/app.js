/* HoodScope frontend logic (EN / US-market conventions) */
(function () {
  'use strict';

  var WL_KEY = 'hoodscope.watchlist';
  var LAST_KEY = 'hoodscope.lastVisit';

  var state = {
    snap: null,
    prevSnap: null,
    search: '',
    sort: 'premDesc',
    th: 0,
    fill: 1000,
    onlyAnomaly: false,
    onlyDex: false,
    view: 'market',
    watchlist: [],
    drawerToken: null,
  };

  try { state.watchlist = JSON.parse(localStorage.getItem(WL_KEY) || '[]') || []; } catch (e) { state.watchlist = []; }

  var $ = function (id) { return document.getElementById(id); };
  var FMT = {
    usd: function (v) {
      if (v === null || v === undefined || !isFinite(v)) return '—';
      var s = v >= 1000 ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : v >= 1 ? v.toFixed(2)
        : v.toFixed(4);
      return '$' + s;
    },
    usdShort: function (v) {
      if (v === null || v === undefined || !isFinite(v)) return '—';
      if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
      if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
      if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'k';
      return '$' + v.toFixed(0);
    },
    prem: function (v) {
      if (v === null || v === undefined || !isFinite(v)) return '—';
      var s = v >= 0 ? '+' : '−';
      return s + Math.abs(v).toFixed(2) + '%';
    },
    fee: function (f) { return (f / 10000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + '%'; },
    time: function (iso) {
      if (!iso) return '—';
      var d = new Date(iso);
      return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    },
    ago: function (unixSec) {
      if (!unixSec) return '—';
      var s = Math.max(0, Date.now() / 1000 - unixSec);
      if (s < 90) return Math.round(s) + 's ago';
      if (s < 3600) return Math.round(s / 60) + 'm ago';
      if (s < 86400) return (s / 3600).toFixed(1) + 'h ago';
      return (s / 86400).toFixed(1) + 'd ago';
    },
    quoteName: function (q) {
      return q === '0x5fc5360d0400a0fd4f2af552add042d716f1d168' ? 'USDG'
        : q === '0x0bd7d308f8e1639fab988df18a8011f41eacad73' ? 'WETH' : (q || '').slice(0, 6);
    },
  };
  var CL_UP = '#0E7C4B', CL_DOWN = '#C2342B', CL_NEUT = '#8B8577';

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function isAnomaly(r) {
    if (r.premium === null) return false;
    var m = state.snap.market;
    return (m.offHours && Math.abs(r.premium) > 2) || Math.abs(r.premium) > 10;
  }

  function isWatched(sym) { return state.watchlist.indexOf(sym) !== -1; }

  // ---------- data ----------
  function load() {
    return fetch('/api/snapshot').then(function (r) {
      if (!r.ok) throw new Error('snapshot ' + r.status);
      return r.json();
    });
  }

  // ---------- views / tabs ----------
  function switchView(v) {
    state.view = v;
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (el) {
      el.classList.toggle('active', el.id === 'view' + v.charAt(0).toUpperCase() + v.slice(1));
    });
    Array.prototype.forEach.call(document.querySelectorAll('.nav-item'), function (t) {
      t.classList.toggle('active', t.dataset.view === v);
    });
    if (v === 'watchlist') renderWatchlist();
    if (v === 'anomalies') renderAnomalies();
    if (v === 'history') fillTMSymbols();
    if (v === 'pons') loadPons();
  }

  function renderTabs() {
    var w = state.watchlist.length;
    $('badgeWatch').textContent = w;
    $('badgeWatch').style.display = w ? '' : 'none';
    var n = state.snap ? state.snap.summary.anomalyCount : 0;
    $('badgeAnom').textContent = n;
    $('badgeAnom').style.display = n ? '' : 'none';
    var s = state.snap;
    if (s) {
      $('sideChain').innerHTML = 'chain ' + s.chain.id + '<br>' + s.summary.feedCount + ' feeds · ' + s.summary.poolCount + ' pools<br>SQLite persisted';
    }
  }

  function renderSinceLastVisit() {
    var s = state.snap;
    var line = $('sinceLine');
    var last = null;
    try { last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch (e) { last = null; }
    var parts = [];
    if (last && last.ts) {
      parts.push('Since your last visit (' + FMT.time(new Date(last.ts).toISOString()) + ')');
      if (typeof last.anomalyCount === 'number' && last.anomalyCount !== s.summary.anomalyCount) {
        parts.push('anomalies: <b>' + s.summary.anomalyCount + '</b> now vs <b>' + last.anomalyCount + '</b> then');
      } else {
        parts.push('anomalies: <b>' + s.summary.anomalyCount + '</b>');
      }
      parts.push('market <b>' + (s.market.offHours ? 'CLOSED' : 'OPEN') + '</b>');
    } else {
      parts.push('Every snapshot is read live from chain + <code>rhj</code> and persisted to local SQLite');
    }
    line.innerHTML = parts.join(' · ');
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ ts: Date.now(), anomalyCount: s.summary.anomalyCount }));
    } catch (e) { /* storage unavailable */ }
  }

  // ---------- render ----------
  function renderAll() {
    if (!state.snap) return;
    renderHeader();
    renderKpis();
    renderTape();
    renderCharts();
    renderTable();
    renderTabs();
    renderSinceLastVisit();
    renderWatchlist();
    renderAnomalies();
    if (state.drawerToken) refreshDrawerWatchBtn();
  }

  function renderHeader() {
    var s = state.snap;
    $('chainline').textContent = 'chain ' + s.chain.id + ' · block ' + (s.chain.block ? s.chain.block.toLocaleString('en-US') : '—');
    $('asof').textContent = 'Last sweep ' + FMT.time(s.generatedAt) + ' · sweeps every 30s';
  }

  // count-up animation for KPI numbers
  function animateNum(el, to) {
    var from = parseFloat(el.textContent) || 0;
    if (from === to || !isFinite(from) || !isFinite(to)) { el.textContent = to; return; }
    var t0 = null, dur = 450;
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      el.textContent = Math.round(from + (to - from) * p);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function renderKpis() {
    var s = state.snap;
    animateNum($('kTotal'), s.summary.total);
    animateNum($('kRef'), s.summary.withRef);
    animateNum($('kDex'), s.summary.withDex);
    animateNum($('kAnomaly'), s.summary.anomalyCount);
    var pill = $('statusPill'), det = $('statusDetail');
    if (s.market.offHours) {
      pill.textContent = 'CLOSED';
      pill.className = 'status-pill closed';
      det.textContent = 'ET ' + s.market.weekday + ' ' + s.market.nyTime + ' · Market closed — off-hours premiums typically widen';
    } else {
      pill.textContent = 'OPEN';
      pill.className = 'status-pill open';
      det.textContent = 'ET ' + s.market.weekday + ' ' + s.market.nyTime + ' · Regular trading hours';
    }
    // deltas vs last refresh (real session comparison)
    if (state.prevSnap) {
      var dDex = s.summary.withDex - state.prevSnap.summary.withDex;
      var dAnom = s.summary.anomalyCount - state.prevSnap.summary.anomalyCount;
      setDelta($('deltaDex'), dDex);
      setDelta($('deltaAnom'), dAnom);
    } else {
      $('deltaDex').textContent = '—';
      $('deltaAnom').textContent = '—';
    }
  }

  function setDelta(el, d) {
    if (d > 0) { el.textContent = '▲ +' + d + ' vs last refresh'; el.className = 'kpi-delta up'; }
    else if (d < 0) { el.textContent = '▼ ' + d + ' vs last refresh'; el.className = 'kpi-delta down'; }
    else { el.textContent = '· steady vs last refresh'; el.className = 'kpi-delta flat'; }
  }

  function renderTape() {
    var rows = filtered().filter(function (r) { return r.premium !== null; })
      .sort(function (a, b) { return Math.abs(b.premium) - Math.abs(a.premium); }).slice(0, 14);
    var html = rows.map(function (r) {
      var cls = r.premium >= 0 ? 'up' : 'down';
      return '<span class="tape-item"><span class="sym">' + esc(r.symbol) + '</span><span class="' + cls + '">' + FMT.prem(r.premium) + '</span></span>';
    }).join('');
    if (!html) html = '<span class="tape-item"><span class="sym">No premium data</span></span>';
    $('tapeTrack').innerHTML = html + html;
  }

  function filtered() {
    var s = state.snap, q = state.search.trim().toLowerCase();
    var out = s.tokens.filter(function (r) {
      if (state.onlyDex && !r.dex) return false;
      if (state.onlyAnomaly && !isAnomaly(r)) return false;
      if (state.th > 0 && (r.premium === null || Math.abs(r.premium) <= state.th)) return false;
      if (q && r.symbol.toLowerCase().indexOf(q) === -1 && r.name.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var sort = state.sort;
    out.sort(function (a, b) {
      switch (sort) {
        case 'premDesc': return (b.premium === null ? -1e9 : b.premium) - (a.premium === null ? -1e9 : a.premium);
        case 'premAsc': return (a.premium === null ? 1e9 : a.premium) - (b.premium === null ? 1e9 : b.premium);
        case 'tvlDesc': return (b.tvl || 0) - (a.tvl || 0);
        case 'priceDesc': return (b.dex ? b.dex.price : b.ref ? b.ref.price : 0) - (a.dex ? a.dex.price : a.ref ? a.ref.price : 0);
        case 'symbol': return a.symbol < b.symbol ? -1 : 1;
      }
    });
    return out;
  }

  function renderCharts() {
    renderDist();
    renderMovers();
  }

  function renderDist() {
    var el = $('chartDist');
    el.classList.remove('skel-box');
    var chart = echarts.getInstanceByDom(el) || echarts.init(el);
    var rows = state.snap.tokens.filter(function (r) { return r.premium !== null; });
    var bins = [], labels = [];
    for (var i = -15; i <= 15; i++) { bins.push(0); labels.push((i > 0 ? '+' : '') + i + '%'); }
    rows.forEach(function (r) {
      var idx = Math.max(0, Math.min(30, Math.round(r.premium) + 15));
      bins[idx]++;
    });
    chart.setOption({
      animationDuration: 600,
      textStyle: { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", color: '#334155' },
      grid: { left: 44, right: 16, top: 14, bottom: 34 },
      tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'shadow' } },
      xAxis: {
        type: 'category', data: labels, boundaryGap: true,
        axisLabel: { fontSize: 10, color: '#64748B', interval: 2 },
        axisLine: { lineStyle: { color: '#CBD5E1' } }, axisTick: { show: false },
      },
      yAxis: {
        type: 'value', minInterval: 1,
        axisLabel: { fontSize: 10, color: '#64748B' },
        splitLine: { lineStyle: { color: '#E6E8EC' } },
      },
      series: [{
        type: 'bar', data: bins, barWidth: '62%',
        itemStyle: { color: function (p) { return p.dataIndex < 15 ? CL_DOWN : p.dataIndex > 15 ? CL_UP : CL_NEUT; } },
      }],
    });
    new ResizeObserver(function () { chart.resize(); }).observe(el);
  }

  function renderMovers() {
    var el = $('chartMovers');
    el.classList.remove('skel-box');
    var chart = echarts.getInstanceByDom(el) || echarts.init(el);
    var rows = state.snap.tokens.filter(function (r) { return r.premium !== null; })
      .sort(function (a, b) { return Math.abs(b.premium) - Math.abs(a.premium); }).slice(0, 12).reverse();
    chart.setOption({
      animationDuration: 600,
      textStyle: { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", color: '#334155' },
      grid: { left: 64, right: 74, top: 8, bottom: 26 },
      tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'shadow' }, valueFormatter: function (v) { return v.toFixed(2) + '%'; } },
      xAxis: {
        type: 'value',
        axisLabel: { fontSize: 10, color: '#64748B', formatter: function (v) { return v + '%'; } },
        splitLine: { lineStyle: { color: '#E6E8EC' } },
      },
      yAxis: {
        type: 'category', data: rows.map(function (r) { return r.symbol; }),
        axisLabel: { fontSize: 11, color: '#0F172A', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 },
        axisLine: { lineStyle: { color: '#CBD5E1' } }, axisTick: { show: false },
      },
      series: [{
        type: 'bar', data: rows.map(function (r) { return r.premium; }), barWidth: '58%',
        itemStyle: { color: function (p) { return rows[p.dataIndex].premium >= 0 ? CL_UP : CL_DOWN; } },
        label: {
          show: true, position: 'right', fontSize: 10.5,
          formatter: function (p) { return FMT.prem(rows[p.dataIndex].premium); },
        },
      }],
    });
    new ResizeObserver(function () { chart.resize(); }).observe(el);
  }

  function renderTable() {
    var rows = filtered();
    $('resultCount').textContent = rows.length + ' / ' + state.snap.summary.total + ' tokens';
    var body = $('tokenBody');
    body.innerHTML = '';
    if (!rows.length) {
      var tr = document.createElement('tr');
      tr.className = 'loading-row';
      var td = document.createElement('td');
      td.colSpan = 8;
      td.textContent = 'No tokens match the current filters';
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }
    rows.forEach(function (r, i) {
      var tr = document.createElement('tr');
      if (isAnomaly(r)) tr.className = 'anomaly';
      else if (!r.dex) tr.className = 'no-dex';
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', function () { openDrawer(r); });

      var tdRank = document.createElement('td'); tdRank.className = 'c-rank'; tdRank.textContent = String(i + 1).padStart(2, '0');
      var tdSym = document.createElement('td'); tdSym.className = 'c-sym';
      tdSym.appendChild(symCell(r));

      var tdRef = document.createElement('td');
      tdRef.appendChild(refCell(r));

      var tdDex = document.createElement('td');
      tdDex.appendChild(dexCell(r));

      var tdPrem = document.createElement('td');
      tdPrem.appendChild(premCell(r));

      var tdPool = document.createElement('td'); tdPool.className = 'pool-cell';
      tdPool.appendChild(poolCell(r));

      var tdMult = document.createElement('td'); tdMult.className = 'mult';
      tdMult.textContent = r.multiplier ? '×' + r.multiplier.toFixed(4) : '—';

      var tdEv = document.createElement('td'); tdEv.className = 'c-ev';
      var btn = document.createElement('button');
      btn.className = 'ev-btn'; btn.type = 'button'; btn.textContent = 'Evidence';
      btn.addEventListener('click', function (ev) { ev.stopPropagation(); openDrawer(r); });
      tdEv.appendChild(btn);

      tr.appendChild(tdRank); tr.appendChild(tdSym); tr.appendChild(tdRef); tr.appendChild(tdDex);
      tr.appendChild(tdPrem); tr.appendChild(tdPool); tr.appendChild(tdMult); tr.appendChild(tdEv);
      body.appendChild(tr);
    });
  }

  // ---------- watchlist ----------
  function toggleWatch(sym) {
    var i = state.watchlist.indexOf(sym);
    if (i === -1) state.watchlist.push(sym); else state.watchlist.splice(i, 1);
    try { localStorage.setItem(WL_KEY, JSON.stringify(state.watchlist)); } catch (e) { /* noop */ }
    renderTabs();
    renderTable();
    renderWatchlist();
    if (state.view === 'anomalies') renderAnomalies();
    if (state.drawerToken) refreshDrawerWatchBtn();
  }

  function starBtn(sym) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'star' + (isWatched(sym) ? ' on' : '');
    b.textContent = isWatched(sym) ? '★' : '☆';
    b.title = isWatched(sym) ? 'Untrack ' + sym : 'Track ' + sym;
    b.setAttribute('aria-label', b.title);
    b.addEventListener('click', function (ev) { ev.stopPropagation(); toggleWatch(sym); });
    return b;
  }

  function symCell(r) {
    var wrap = document.createElement('div');
    wrap.className = 'sym-cell';
    wrap.appendChild(starBtn(r.symbol));
    var left = document.createElement('div');
    var nm = document.createElement('div'); nm.className = 'sym-name'; nm.textContent = r.symbol;
    var full = document.createElement('div'); full.className = 'sym-full'; full.textContent = r.name;
    left.appendChild(nm); left.appendChild(full);
    var badge = document.createElement('span');
    badge.className = 'type-badge';
    badge.textContent = r.type === 'ETF' ? 'ETF' : 'STOCK';
    wrap.appendChild(left); wrap.appendChild(badge);
    return wrap;
  }

  function refCell(r) {
    var wrap = document.createElement('span');
    if (!r.ref) { wrap.textContent = '—'; return wrap; }
    wrap.textContent = FMT.usd(r.ref.price);
    var tag = document.createElement('span');
    if (r.ref.source === 'chainlink') {
      tag.className = 'tag cl'; tag.textContent = 'CL';
      if (r.ref.stale) { tag.textContent = 'STALE'; tag.className = 'tag stale'; }
    } else {
      tag.className = 'tag rhj'; tag.textContent = 'RHJ';
      if (r.ref.isTradingHalt) { tag.textContent = 'HALT'; tag.className = 'tag stale'; }
      else if (r.ref.unreliable) { tag.textContent = 'REF?'; tag.className = 'tag stale'; }
    }
    wrap.appendChild(tag);
    return wrap;
  }

  function dexCell(r) {
    var wrap = document.createElement('span');
    if (!r.dex) {
      wrap.textContent = '—';
      var tag = document.createElement('span');
      tag.className = 'tag nopool'; tag.textContent = 'No pool';
      wrap.appendChild(tag);
      return wrap;
    }
    wrap.textContent = FMT.usd(r.dex.price);
    return wrap;
  }

  function premCell(r) {
    var wrap = document.createElement('div');
    wrap.className = 'prem-cell';
    var top = document.createElement('div');
    top.className = 'prem-top';
    var num = document.createElement('span');
    num.className = 'prem-num ' + (r.premium === null ? 'flat' : r.premium > 0.05 ? 'up' : r.premium < -0.05 ? 'down' : 'flat');
    num.textContent = FMT.prem(r.premium);
    var bar = document.createElement('span');
    bar.className = 'prem-bar';
    if (r.premium !== null) {
      var fill = document.createElement('span');
      var pct = Math.min(Math.abs(r.premium) / 15, 1) * 100;
      fill.className = 'fill ' + (r.premium >= 0 ? 'up' : 'down');
      fill.style.width = pct + '%';
      bar.appendChild(fill);
    }
    top.appendChild(num); top.appendChild(bar);
    wrap.appendChild(top);
    if (r.ref && r.ref.unreliable && r.premium === null) {
      var note = document.createElement('div');
      note.className = 'prem-exec flat';
      note.textContent = 'ref unreliable — premium withheld';
      wrap.appendChild(note);
    }
    if (r.exec && r.exec[state.fill] !== undefined) {
      var ex = document.createElement('div');
      var ev = r.exec[state.fill];
      ex.className = 'prem-exec ' + (ev === null ? 'flat' : ev > 0.05 ? 'up' : ev < -0.05 ? 'down' : 'flat');
      ex.textContent = ev === null
        ? 'exec @$' + (state.fill >= 1000 ? (state.fill / 1000) + 'k' : state.fill) + ' illiquid'
        : 'exec @$' + (state.fill >= 1000 ? (state.fill / 1000) + 'k' : state.fill) + ' ' + FMT.prem(ev);
      wrap.appendChild(ex);
    }
    return wrap;
  }

  function poolCell(r) {
    var wrap = document.createElement('div');
    if (!r.dex) { wrap.textContent = '—'; return wrap; }
    var line1 = document.createElement('div');
    line1.textContent = 'Uniswap V3 · ' + FMT.quoteName(r.dex.quote) + ' · ' + FMT.fee(r.dex.fee);
    if (r.dex.tvl !== null && r.dex.tvl < 50000) {
      var thin = document.createElement('span');
      thin.className = 'tag thin';
      thin.textContent = 'THIN';
      line1.appendChild(thin);
    }
    var line2 = document.createElement('div');
    line2.className = 'pool-addr';
    line2.textContent = 'TVL ' + FMT.usdShort(r.dex.tvl) + ' · ' + r.dex.pool.slice(0, 6) + '…' + r.dex.pool.slice(-4);
    wrap.appendChild(line1); wrap.appendChild(line2);
    return wrap;
  }

  // ---------- watchlist view ----------
  function renderWatchlist() {
    var grid = $('watchGrid');
    grid.innerHTML = '';
    var empty = $('watchEmpty');
    if (!state.watchlist.length) { empty.hidden = false; return; }
    empty.hidden = true;
    var bySym = {};
    state.snap.tokens.forEach(function (r) { bySym[r.symbol] = r; });
    state.watchlist.forEach(function (sym) {
      var r = bySym[sym];
      if (!r) return;
      grid.appendChild(watchCard(r));
    });
    // re-render if some symbols vanished from registry
    var missing = state.watchlist.filter(function (s) { return !bySym[s]; });
    if (missing.length) {
      missing.forEach(function (s) {
        var i = state.watchlist.indexOf(s); if (i !== -1) state.watchlist.splice(i, 1);
      });
      try { localStorage.setItem(WL_KEY, JSON.stringify(state.watchlist)); } catch (e) { /* noop */ }
      renderTabs();
    }
  }

  function watchCard(r) {
    var card = document.createElement('div');
    card.className = 'watch-card' + (isAnomaly(r) ? ' anom' : '');
    var top = document.createElement('div');
    top.className = 'watch-top';
    var left = document.createElement('div');
    var nm = document.createElement('div'); nm.className = 'watch-sym'; nm.textContent = r.symbol;
    var full = document.createElement('div'); full.className = 'watch-full'; full.textContent = r.name;
    left.appendChild(nm); left.appendChild(full);
    var rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'star on'; rm.textContent = '★';
    rm.title = 'Untrack ' + r.symbol;
    rm.addEventListener('click', function () { toggleWatch(r.symbol); });
    top.appendChild(left); top.appendChild(rm);
    card.appendChild(top);

    var prem = document.createElement('div');
    prem.className = 'prem-big ' + (r.premium === null ? 'flat' : r.premium >= 0 ? 'up' : 'down');
    prem.textContent = FMT.prem(r.premium);
    card.appendChild(prem);

    var row = document.createElement('div');
    row.className = 'watch-row';
    row.innerHTML = '<span>Ref <b>' + FMT.usd(r.ref ? r.ref.price : null) + '</b></span>'
      + '<span>DEX <b>' + FMT.usd(r.dex ? r.dex.price : null) + '</b></span>'
      + '<span>TVL <b>' + FMT.usdShort(r.dex ? r.dex.tvl : null) + '</b></span>';
    card.appendChild(row);

    var act = document.createElement('div');
    act.className = 'watch-actions';
    var ev = document.createElement('button');
    ev.type = 'button'; ev.className = 'ev-btn'; ev.textContent = 'Evidence & history';
    ev.addEventListener('click', function () { openDrawer(r); });
    act.appendChild(ev);
    card.appendChild(act);

    card.addEventListener('click', function () { openDrawer(r); });
    return card;
  }

  // ---------- anomalies view ----------
  function renderAnomalies() {
    var list = $('anomList');
    list.innerHTML = '';
    var empty = $('anomEmpty');
    if (!state.snap) return;
    var rows = state.snap.tokens.filter(isAnomaly)
      .sort(function (a, b) { return Math.abs(b.premium) - Math.abs(a.premium); });
    empty.hidden = rows.length ? true : false;
    rows.forEach(function (r) {
      var card = document.createElement('div');
      card.className = 'anom-card';
      var sym = document.createElement('div'); sym.className = 'anom-sym'; sym.textContent = r.symbol;
      var name = document.createElement('div'); name.className = 'anom-name'; name.textContent = r.name;
      var prem = document.createElement('div');
      prem.className = 'prem-big ' + (r.premium >= 0 ? 'up' : 'down');
      prem.textContent = FMT.prem(r.premium);
      var mid = document.createElement('div'); mid.className = 'anom-mid';
      mid.innerHTML = 'Ref <b>' + FMT.usd(r.ref ? r.ref.price : null) + '</b> → DEX <b>' + FMT.usd(r.dex ? r.dex.price : null) + '</b>'
        + (r.dex && r.dex.tvl !== null && r.dex.tvl < 50000 ? ' · <span class="tag thin">THIN</span>' : '');
      var act = document.createElement('div'); act.className = 'anom-actions';
      var ev = document.createElement('button');
      ev.type = 'button'; ev.className = 'ev-btn'; ev.textContent = 'Evidence & history';
      ev.addEventListener('click', function (e) { e.stopPropagation(); openDrawer(r); });
      var st = starBtn(r.symbol);
      act.appendChild(st); act.appendChild(ev);
      card.appendChild(sym); card.appendChild(name); card.appendChild(prem); card.appendChild(mid); card.appendChild(act);
      card.addEventListener('click', function () { openDrawer(r); });
      list.appendChild(card);
    });

    // coverage transparency
    var cov = $('coverageBox');
    var s = state.snap;
    var noDex = s.tokens.filter(function (t) { return !t.dex; }).length;
    var thin = s.tokens.filter(function (t) { return t.dex && t.dex.tvl !== null && t.dex.tvl < 50000; }).length;
    cov.innerHTML = '<div class="cov-title">Coverage, honestly</div>'
      + '<div class="cov-row"><span>' + s.summary.withRef + ' / ' + s.summary.total + ' tokens have a reference price</span></div>'
      + '<div class="cov-row"><span>' + s.summary.withDex + ' have a DEX price (USDG/WETH pool)</span></div>'
      + '<div class="cov-row"><span>' + noDex + ' show reference only — no liquid pair found yet</span></div>'
      + '<div class="cov-row"><span>' + thin + ' pools are THIN (TVL &lt; $50k) — premium readings less reliable there</span></div>';
  }

  // ---------- export / api ----------
  function exportCsv() {
    var rows = filtered();
    if (!rows.length) { showError('Nothing to export — current filters return no rows.'); return; }
    var lines = ['rank,symbol,name,type,ref_source,ref_price,dex_price,premium_pct,tvl_usd,multiplier'];
    rows.forEach(function (r, i) {
      lines.push([
        i + 1,
        '"' + r.symbol + '"',
        '"' + String(r.name || '').replace(/"/g, '""') + '"',
        r.type || '',
        r.ref ? r.ref.source : '',
        r.ref ? r.ref.price : '',
        r.dex ? r.dex.price : '',
        r.premium !== null ? r.premium.toFixed(4) : '',
        (r.dex && r.dex.tvl !== null) ? r.dex.tvl : '',
        r.multiplier || '',
      ].join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hoodscope-premium-snapshot.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  function copyApi() {
    var text = 'curl ' + window.location.origin + '/api/snapshot';
    var btn = $('apiBtn');
    function done() { btn.textContent = 'Copy API'; setTimeout(function () { btn.style.opacity = '1'; }, 400); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = 'Copied ✓';
        setTimeout(done, 1400);
      }).catch(function () { window.prompt('Copy this endpoint:', text); done(); });
    } else {
      window.prompt('Copy this endpoint:', text);
    }
  }

  // ---------- verify view ----------
  function verifyHash() {
    var input = $('verifyInput');
    var hash = input.value.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      showVerifyResult('<div class="vstate fail">Enter a valid 64-character SHA-256 hash.</div>');
      return;
    }
    var btn = $('verifyBtn');
    btn.disabled = true; btn.textContent = 'Verifying…';
    fetch('/api/evidence?hash=' + encodeURIComponent(hash)).then(function (r) { return r.json(); })
      .then(function (res) {
        var html = '<div class="vrow"><span class="ev-k">Report hash</span><span class="ev-v">' + esc(res.hash) + '</span></div>';
        if (res.localCid) html += '<div class="vrow"><span class="ev-k">CID fingerprint (recomputed)</span><span class="ev-v">' + esc(res.localCid) + '</span></div>';
        if (res.status === 'not_configured') {
          html += '<div class="vstate warn">On-chain anchoring is pending deployment. The <code>AnchorRegistry</code> contract is ready (compiled); once deployed and configured via <code>ANCHOR_REGISTRY_ADDRESS</code>, this endpoint will return the on-chain anchor record. Today it returns the local fingerprint only — the hash itself is deterministic and can be recomputed independently.</div>';
        } else if (res.status === 'verified') {
          html += '<div class="vstate ok">Verified on-chain ✓ — anchor exists in the registry (see record below).</div>';
        } else if (res.status === 'not_found') {
          html += '<div class="vstate fail">No on-chain anchor found for this hash.</div>';
        } else {
          html += '<div class="vstate">Status: ' + esc(res.status || 'unknown') + '</div>';
        }
        showVerifyResult(html);
      })
      .catch(function (err) {
        showVerifyResult('<div class="vstate fail">Verify failed: ' + esc(err.message) + '</div>');
      })
      .finally(function () {
        btn.disabled = false; btn.textContent = 'Verify';
      });
  }

  function showVerifyResult(html) {
    var el = $('verifyResult');
    el.hidden = false;
    el.innerHTML = html;
  }

  // ---------- drawer ----------
  function openDrawer(r) {
    var s = state.snap;
    state.drawerToken = r;
    $('dSym').textContent = r.symbol;
    $('dName').textContent = r.name + ' · ' + (r.type === 'ETF' ? 'ETF' : 'Stock Token') + ' · ' + (r.multiplier ? 'multiplier ×' + r.multiplier.toFixed(4) : '');
    refreshDrawerWatchBtn();
    var body = $('drawerBody');
    body.innerHTML = '';

    // overview
    var big = document.createElement('div');
    big.className = 'prem-big ' + (r.premium === null ? 'flat' : r.premium >= 0 ? 'up' : 'down');
    big.textContent = FMT.prem(r.premium);
    body.appendChild(big);
    var formula = document.createElement('div');
    formula.className = 'formula';
    formula.textContent = 'Premium = (DEX price − reference price) ÷ reference price × 100%'
      + '\nReference ' + FMT.usd(r.ref ? r.ref.price : null)
      + ' → DEX ' + FMT.usd(r.dex ? r.dex.price : null);
    if (r.exec && r.exec[state.fill] !== undefined) {
      var ev = r.exec[state.fill];
      formula.textContent += ev === null
        ? '\nExec premium @$' + (state.fill >= 1000 ? (state.fill / 1000) + 'k' : state.fill) + ': pool is illiquid at this size (est. impact > 50%)'
        : '\nExec premium @$' + (state.fill >= 1000 ? (state.fill / 1000) + 'k' : state.fill)
          + ' ≈ ' + FMT.prem(ev) + ' (mid premium minus estimated price impact on pool TVL — estimate, not a routed quote)';
    }
    body.appendChild(formula);

    // reference block
    var refBlock = block('REFERENCE EVIDENCE ' + (r.ref && r.ref.source === 'chainlink' ? '· CHAINLINK FEED' : '· ROBINHOOD RHJ API'));
    if (r.ref) {
      if (r.ref.source === 'chainlink') {
        refBlock.add('Reference price', FMT.usd(r.ref.price));
        refBlock.add('Source', 'Chainlink aggregator');
        refBlock.add('Feed address', shortLink(r.ref.feed), true);
        refBlock.add('Round ID', r.ref.roundId);
        refBlock.add('Updated', new Date(r.ref.updatedAt * 1000).toUTCString() + ' (' + FMT.ago(r.ref.updatedAt) + ')');
        if (r.ref.stale) refBlock.note('Feed not updated in >2h — Chainlink freezes at the last close during market closure; this is the premise of off-hours premium analysis.');
      } else {
        refBlock.add('Reference price', FMT.usd(r.ref.price) + ' (rhj bid × multiplier)');
        refBlock.add('rhj bid', FMT.usd(r.ref.bid));
        refBlock.add('Quote time', FMT.time(r.ref.generatedAt));
        if (r.ref.dailyVolume) refBlock.add('24h notional volume', FMT.usdShort(r.ref.dailyVolume));
        if (r.ref.dailyHigh || r.ref.dailyLow) refBlock.add('Day range', FMT.usd(r.ref.dailyLow) + ' – ' + FMT.usd(r.ref.dailyHigh));
        if (r.ref.isTradingHalt) refBlock.note('Security currently flagged as trading-halted (rhj isTradingHalt).');
      }
    } else {
      refBlock.add('Reference price', 'N/A');
    }
    body.appendChild(refBlock.el);

    // dex block
    var dexBlock = block('DEX EVIDENCE ' + (r.dex ? '· UNISWAP V3' : '· NO USDG/WETH POOL'));
    if (r.dex) {
      dexBlock.add('DEX price', FMT.usd(r.dex.price));
      dexBlock.add('Pool address', shortLink(r.dex.pool), true);
      dexBlock.add('Quote', FMT.quoteName(r.dex.quote));
      dexBlock.add('Fee tier', FMT.fee(r.dex.fee));
      dexBlock.add('Pool TVL', FMT.usdShort(r.dex.tvl));
      if (r.dex.tvl !== null && r.dex.tvl < 50000) {
        dexBlock.note('Pool TVL < $50k (thin pool): price driven by minimal liquidity; premium reading less reliable.');
      }
    } else {
      dexBlock.add('Note', 'No USDG/WETH pool found on Robinhood Chain (may pair only with meme or other tokens); no DEX premium available.');
    }
    body.appendChild(dexBlock.el);

    // history block (async)
    var histBlock = block('PREMIUM HISTORY · PERSISTED SNAPSHOTS');
    histBlock.el.dataset.hist = '';
    var histBody = histBlock.el.querySelector('.ev-block-body');
    histBody.innerHTML = '<div class="mini-note">Loading persisted snapshots from local SQLite…</div>';
    body.appendChild(histBlock.el);

    // events block (async)
    var evBlock = block('RECENT PREMIUM EVENTS · |PREMIUM| &gt; 2%');
    evBlock.el.dataset.ev = '';
    var evBody = evBlock.el.querySelector('.ev-block-body');
    evBody.innerHTML = '<div class="mini-note">Loading…</div>';
    body.appendChild(evBlock.el);

    // token block
    var tokBlock = block('TOKEN INFO');
    tokBlock.add('Contract address', shortLink(r.address), true);
    tokBlock.add('Multiplier', r.multiplier ? r.multiplier.toFixed(4) : '—');
    tokBlock.add('Type', r.type);
    tokBlock.add('Total supply', 'Loading on-chain…');
    body.appendChild(tokBlock.el);
    // live ERC20 supply from chain (name/symbol/decimals/totalSupply)
    fetch('/api/token-info?symbol=' + encodeURIComponent(r.symbol)).then(function (resp) { return resp.json(); })
      .then(function (info) {
        var rows = tokBlock.el.querySelectorAll('.ev-row');
        var last = rows[rows.length - 1];
        if (!last) return;
        var v = last.querySelector('.ev-v');
        if (info.totalSupplyHuman !== null && info.totalSupplyHuman !== undefined) {
          v.textContent = info.totalSupplyHuman + ' tokens (' + (info.onChainSymbol || r.symbol) + ' · ' + info.decimals + ' decimals)';
        } else {
          v.textContent = 'unavailable';
        }
      })
      .catch(function () {
        var rows = tokBlock.el.querySelectorAll('.ev-row');
        var last = rows[rows.length - 1];
        if (last) last.querySelector('.ev-v').textContent = 'unavailable';
      });

    // snapshot block
    var snapBlock = block('SNAPSHOT CONTEXT');
    snapBlock.add('Data time', FMT.time(s.generatedAt));
    snapBlock.add('Chain', 'Robinhood Chain (chain id ' + s.chain.id + ') · block ' + (s.chain.block || '—'));
    snapBlock.add('ETH/USD', FMT.usd(s.ethUsd));
    if (s.ethPoolEvidence) snapBlock.add('ETH price source', 'WETH/USDG pool ' + FMT.fee(s.ethPoolEvidence.fee) + ' · ' + s.ethPoolEvidence.pool.slice(0, 8) + '…');
    body.appendChild(snapBlock.el);

    var note = document.createElement('div');
    note.className = 'note-line';
    note.textContent = 'Click an address to verify independently on Blockscout. During off-hours the reference price is the frozen last close; premium widening is a structural phenomenon, not after-hours price discovery.';
    body.appendChild(note);

    $('drawer').classList.add('open');
    $('drawer').setAttribute('aria-hidden', 'false');
    $('drawerMask').classList.add('show');

    // async: history + events
    fetch('/api/history?symbol=' + encodeURIComponent(r.symbol)).then(function (resp) { return resp.json(); })
      .then(function (res) { renderHistoryBlock(histBlock.el, r.symbol, res); })
      .catch(function () { histBody.innerHTML = '<div class="mini-note">History unavailable right now.</div>'; });
    fetch('/api/events?symbol=' + encodeURIComponent(r.symbol)).then(function (resp) { return resp.json(); })
      .then(function (res) { renderEventsBlock(evBlock.el, r.symbol, res); })
      .catch(function () { evBody.innerHTML = '<div class="mini-note">Events unavailable right now.</div>'; });
  }

  function refreshDrawerWatchBtn() {
    var r = state.drawerToken;
    if (!r) return;
    var b = $('dWatchBtn');
    var on = isWatched(r.symbol);
    b.textContent = on ? '★' : '☆';
    b.title = on ? 'Untrack ' + r.symbol : 'Track ' + r.symbol;
  }

  function renderHistoryBlock(el, symbol, res) {
    var body = el.querySelector('.ev-block-body');
    var rows = (res && res.rows) || [];
    if (!rows.length) {
      body.innerHTML = '<div class="mini-note">No persisted snapshots yet. Snapshots are stored every 5 min from this deployment forward — history builds up from here.</div>';
      return;
    }
    var pts = rows.map(function (r) { return { t: new Date(r.generated_at).getTime(), p: r.premium }; })
      .filter(function (d) { return d.p !== null && isFinite(d.p); });
    if (pts.length < 2) {
      body.innerHTML = '<div class="mini-note">Only 1 snapshot point so far — keep the server running and history will accumulate.</div>';
      return;
    }
    var W = 540, H = 60, pad = 4;
    var min = Math.min.apply(null, pts.map(function (d) { return d.p; }));
    var max = Math.max.apply(null, pts.map(function (d) { return d.p; }));
    if (max === min) { max = min + 1; min = min - 1; }
    var y = function (p) { return pad + (H - 2 * pad) * (1 - (p - min) / (max - min)); };
    var x = function (i) { return (pts.length === 1 ? W / 2 : i / (pts.length - 1) * W); };
    var line = pts.map(function (d, i) { return x(i).toFixed(1) + ',' + y(d.p).toFixed(1); }).join(' ');
    var zeroY = y(0).toFixed(1);
    var first = FMT.time(new Date(pts[0].t).toISOString());
    var last = FMT.time(new Date(pts[pts.length - 1].t).toISOString());
    var html = '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Premium history for ' + esc(symbol) + '">'
      + '<line x1="0" y1="' + zeroY + '" x2="' + W + '" y2="' + zeroY + '" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="4 4"/>'
      + '<polyline points="' + line + '" fill="none" stroke="#0F172A" stroke-width="1.8"/>'
      + '</svg>'
      + '<div class="mini-note">' + pts.length + ' persisted snapshots · ' + first + ' → ' + last
      + ' · premium %, zero line = reference price</div>';
    body.innerHTML = html;
  }

  function renderEventsBlock(el, symbol, res) {
    var body = el.querySelector('.ev-block-body');
    var rows = (res && res.rows) || [];
    if (!rows.length) {
      body.innerHTML = '<div class="mini-note">No |premium| &gt; 2% events recorded yet for ' + esc(symbol) + '. Events are detected on each refresh and persisted.</div>';
      return;
    }
    var html = rows.map(function (r) {
      var peak = (typeof r.peak_premium === 'number' ? FMT.prem(r.peak_premium) : '—');
      var start = r.started_at ? FMT.time(r.started_at) : '—';
      var end = r.ended_at ? FMT.time(r.ended_at) : 'ongoing';
      var thr = typeof r.threshold === 'number' ? '|' + r.threshold + '%' : '';
      return '<div class="ev-row"><span class="ev-k">' + esc(symbol) + ' · threshold ' + thr + '</span><span class="ev-v">' + start + ' → ' + end + ' · peak ' + peak + '</span></div>';
    }).join('');
    body.innerHTML = html;
  }

  function closeDrawer() {
    $('drawer').classList.remove('open');
    $('drawer').setAttribute('aria-hidden', 'true');
    $('drawerMask').classList.remove('show');
    state.drawerToken = null;
  }

  function block(title) {
    var el = document.createElement('div');
    el.className = 'ev-block';
    var head = document.createElement('div');
    head.className = 'ev-block-head';
    head.textContent = title;
    var body = document.createElement('div');
    body.className = 'ev-block-body';
    el.appendChild(head); el.appendChild(body);
    return {
      el: el,
      add: function (k, v, isHtml) {
        var row = document.createElement('div');
        row.className = 'ev-row';
        var kd = document.createElement('span'); kd.className = 'ev-k'; kd.textContent = k;
        var vd = document.createElement('span'); vd.className = 'ev-v';
        if (isHtml) vd.innerHTML = v; else vd.textContent = v;
        row.appendChild(kd); row.appendChild(vd);
        body.appendChild(row);
      },
      note: function (t) {
        var n = document.createElement('div');
        n.className = 'note-line'; n.style.marginTop = '4px'; n.style.borderTop = 'none'; n.style.paddingTop = '2px';
        n.textContent = t;
        body.appendChild(n);
      },
    };
  }

  function shortLink(addr) {
    var a = document.createElement('a');
    a.className = 'ev-link';
    // Robinscanner is the live Robinhood Chain explorer (blockscout domain is unreachable)
    a.href = 'https://robinscanner.com/addresses/' + addr.toLowerCase();
    a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = addr.slice(0, 6) + '…' + addr.slice(-6);
    return a.outerHTML;
  }

  // ---------- events ----------
  $('globalSearch').addEventListener('input', function (e) {
    state.search = e.target.value;
    if (state.view !== 'market') switchView('market');
    renderTable(); renderTape();
  });
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $('globalSearch').focus();
    }
  });

  $('sortSelect').addEventListener('change', function (e) { state.sort = e.target.value; renderTable(); });
  $('fillSelect').addEventListener('change', function (e) { state.fill = parseInt(e.target.value, 10) || 1000; renderTable(); });
  $('thresholdChips').addEventListener('click', function (e) {
    var btn = e.target.closest('.chip');
    if (!btn) return;
    Array.prototype.forEach.call($('thresholdChips').children, function (c) { c.classList.remove('active'); });
    btn.classList.add('active');
    state.th = parseFloat(btn.dataset.th) || 0;
    renderTable();
  });
  $('onlyAnomaly').addEventListener('change', function (e) { state.onlyAnomaly = e.target.checked; renderTable(); });
  $('onlyDex').addEventListener('change', function (e) { state.onlyDex = e.target.checked; renderTable(); });
  $('drawerClose').addEventListener('click', closeDrawer);
  $('drawerMask').addEventListener('click', closeDrawer);
  $('dWatchBtn').addEventListener('click', function () { if (state.drawerToken) toggleWatch(state.drawerToken.symbol); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
  $('verifyBtn').addEventListener('click', verifyHash);
  $('verifyInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') verifyHash(); });
  $('csvBtn').addEventListener('click', exportCsv);
  $('apiBtn').addEventListener('click', copyApi);

  $('sidenav').addEventListener('click', function (e) {
    var item = e.target.closest('.nav-item');
    if (!item) return;
    switchView(item.dataset.view);
  });
  document.querySelectorAll('.task-btn').forEach(function (b) {
    b.addEventListener('click', function () { switchView(b.dataset.view); });
  });
  document.querySelectorAll('.foot-link[data-jump]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      switchView(a.dataset.jump);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  $('refreshBtn').addEventListener('click', function () {
    var btn = $('refreshBtn');
    btn.disabled = true; btn.textContent = 'Refreshing…';
    fetch('/api/refresh').then(function (r) { return r.json(); }).then(function (res) {
      if (!res.ok) throw new Error(res.detail || 'refresh failed');
      return load();
    }).then(function (s) {
      state.prevSnap = state.snap;
      state.snap = s;
      renderAll();
    }).catch(function (err) {
      showError('Refresh failed: ' + err.message + ' (keeping last snapshot)');
    }).finally(function () {
      btn.disabled = false; btn.textContent = 'Refresh';
    });
  });

  function showError(msg) {
    var old = document.querySelector('.err-banner');
    if (old) old.remove();
    var div = document.createElement('div');
    div.className = 'err-banner';
    div.textContent = msg;
    document.querySelector('.controls').after(div);
  }

  // ---------- skeleton ----------
  function showSkeleton() {
    var body = $('tokenBody');
    body.innerHTML = '';
    for (var i = 0; i < 8; i++) {
      var tr = document.createElement('tr');
      tr.className = 'skel-row';
      for (var c = 0; c < 8; c++) {
        var td = document.createElement('td');
        var s = document.createElement('div');
        s.className = 'skel ' + (c === 0 || c === 7 ? 's2' : 's1');
        td.appendChild(s);
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
  }

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
        if (!n.list.length) { box.innerHTML = '<div class="empty-body">' + esc(n.note || 'No ungraduated launches in the last ' + n.days + ' days with meaningful progress.') + '</div>'; return; }
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
  // ---------- boot ----------
  function boot() {
    showSkeleton();
    load().then(function (s) {
      state.snap = s;
      renderAll();
      // auto refresh every 30s (Prism-style live sweep)
      setInterval(function () {
        load().then(function (s2) {
          state.prevSnap = state.snap;
          state.snap = s2;
          renderAll();
        }).catch(function (err) { showError('Auto-refresh failed: ' + err.message); });
      }, 30000);
    }).catch(function (err) {
      showError('Unable to load data: ' + err.message + '. Make sure the server is running (node server.js).');
    });
  }

  boot();
})();
