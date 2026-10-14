$ErrorActionPreference = 'Stop'
$p = 'C:\Users\小可爱\Doubao\chats\2026-09-16\new-chat\hoodscope\public\styles.css'
$t = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)

$css = @'

/* ---------- time machine ---------- */
.tm-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.tm-controls input[type="text"] { flex: 0 1 220px; }
.tm-controls input[type="range"] { flex: 1 1 180px; min-width: 140px; accent-color: var(--blue); }
.tm-time { font-family: var(--mono); font-size: 12px; color: var(--muted); }
.tm-readout { display: flex; gap: 18px; flex-wrap: wrap; padding: 10px 14px; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; margin-bottom: 12px; font-size: 13px; color: var(--ink-soft); }
.tm-readout b { font-family: var(--mono); color: var(--ink); }
.tm-chart { min-height: 260px; background: var(--card); border: 1px solid var(--line); border-radius: 8px; margin-bottom: 14px; }
.tm-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 14px; }
.tm-stat { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
.tm-stat .k { font-size: 11px; text-transform: uppercase; letter-spacing: .8px; color: var(--muted); }
.tm-stat .v { font-size: 16px; font-family: var(--mono); margin-top: 2px; color: var(--ink); }
.tm-events { display: grid; gap: 8px; }
.tm-ev { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 12.5px; align-items: baseline; color: var(--ink-soft); }
.tm-ev .ev-sym { font-family: var(--mono); font-weight: 600; color: var(--ink); }
.tm-ev .ev-dir { font-family: var(--mono); font-weight: 600; }
.tm-ev .ev-dir.up { color: var(--up, #059669); }
.tm-ev .ev-dir.down { color: var(--down, #DC2626); }
'@

$t += $css
[IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
Write-Output 'TM_CSS_APPENDED'
