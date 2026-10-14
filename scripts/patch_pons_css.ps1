$ErrorActionPreference = 'Stop'
$p = 'C:\Users\小可爱\Doubao\chats\2026-09-16\new-chat\hoodscope\public\styles.css'
$t = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)
if ($t.Contains('.pons-toolbar')) { Write-Output 'ALREADY_PATCHED'; exit 0 }
$block = @'

/* ---------- pons launchpad monitor ---------- */
.pons-toolbar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
.pons-note { font-size: 12px; color: var(--muted); font-family: var(--mono); }
.pons-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; margin-bottom: 14px; }
.pons-card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.pons-card-h { font-size: 13px; font-weight: 600; color: var(--ink); padding: 12px 14px; border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.pons-card-sub { font-size: 11px; font-weight: 400; color: var(--muted); }
.pons-body { padding: 12px 14px; display: grid; gap: 8px; }
.pons-row { display: grid; grid-template-columns: 1.2fr 1fr 1.6fr 1fr auto; gap: 8px; align-items: center; font-size: 12px; color: var(--ink-soft); padding: 7px 0; border-bottom: 1px dashed var(--line); }
.pons-row:last-child { border-bottom: 0; }
.pons-row .ev-sym { font-family: var(--mono); font-weight: 600; color: var(--ink); }
.prog-wrap { display: flex; align-items: center; gap: 8px; }
.prog { flex: 1; height: 7px; background: var(--bg); border-radius: 4px; overflow: hidden; }
.prog-fill { height: 100%; background: linear-gradient(90deg, #1D4ED8, #7C3AED); border-radius: 4px; }
.pill { font-size: 10.5px; padding: 2px 8px; border-radius: 99px; background: var(--bg); border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.pill.ok { color: var(--green, #059669); border-color: rgba(5,150,105,.35); background: rgba(5,150,105,.08); }
.pons-syms { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.pons-syms .pill { font-size: 11px; }
@media (max-width: 720px) {
  .pons-row { grid-template-columns: 1fr 1fr; }
}
'@
$t = $t + $block
[IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
Write-Output 'CSS_PONS_ADDED'
