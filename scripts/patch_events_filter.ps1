$ErrorActionPreference = 'Stop'
$p = 'C:\Users\小可爱\Doubao\chats\2026-09-16\new-chat\hoodscope\server.js'
$t = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)

$old = "      const rows = store.getPremiumEvents(sym, { days });`n      json(res, 200, { symbol: sym, days, count: rows.length, rows });"

$new = "      const raw = store.getPremiumEvents(sym, { days });`n      // historical ref-sanity: drop absurd peaks (ref-source anomalies, e.g. WYFI +3413%)`n      const filtered = raw.filter(function (e) { return Math.abs(e.peak_premium) <= 1000; });`n      json(res, 200, { symbol: sym, days, count: filtered.length, filteredOut: raw.length - filtered.length, rows: filtered });"

if (-not $t.Contains($old)) { Write-Output 'EVENTS_OLD_NOT_FOUND'; exit 1 }
$t = $t.Replace($old, $new)
[IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
Write-Output 'EVENTS_FILTERED'
