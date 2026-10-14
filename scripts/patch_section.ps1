$ErrorActionPreference = 'Stop'
$p = 'C:\Users\小可爱\Doubao\chats\2026-09-16\new-chat\hoodscope\public\index.html'
$t = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)

$old = '        <div class="coverage-box" id="coverageBox"></div>
      </section>

      <!-- ===== VIEW · VERIFY ===== -->'

$new = '        <div class="coverage-box" id="coverageBox"></div>
      </section>

      <!-- ===== VIEW · TIME MACHINE ===== -->
      <section class="view" id="viewHistory">
        <div class="view-head">
          <div class="view-title">Time Machine</div>
          <div class="view-sub">Replay any stock token through the snapshots HoodScope has persisted (every ~5 min). Below: premium events this token triggered — peak, duration, convergence.</div>
        </div>
        <div class="tm-controls">
          <input id="tmSymbol" type="text" placeholder="Symbol, e.g. NVDA" spellcheck="false" autocomplete="off" list="tmSymbols">
          <datalist id="tmSymbols"></datalist>
          <button class="btn" id="tmLoad" type="button">Load</button>
          <button class="btn" id="tmPlay" type="button" disabled>▶ Play</button>
          <input type="range" id="tmSlider" min="0" max="1" step="1" value="0" disabled>
          <span class="tm-time" id="tmTime">—</span>
        </div>
        <div class="tm-readout" id="tmReadout" hidden></div>
        <div class="tm-chart" id="tmChart"></div>
        <div class="tm-stats" id="tmStats"></div>
        <div class="tm-events" id="tmEvents"></div>
        <div class="empty-state" id="tmEmpty">
          <div class="empty-title">Pick a symbol to replay</div>
          <div class="empty-body">Load a token to see its premium path across persisted snapshots, plus every threshold event it triggered.</div>
        </div>
      </section>

      <!-- ===== VIEW · VERIFY ===== -->'

if (-not $t.Contains($old)) { Write-Output 'SECTION_OLD_NOT_FOUND'; exit 1 }
$t = $t.Replace($old, $new)
[IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
Write-Output 'SECTION_PATCHED'
