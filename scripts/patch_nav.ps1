$ErrorActionPreference = 'Stop'
$p = 'C:\Users\小可爱\Doubao\chats\2026-09-16\new-chat\hoodscope\public\index.html'
$t = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)

$old = '<button class="nav-item" data-view="anomalies" type="button"><span class="ni-icon">⚠</span> Anomalies <span class="badge" id="badgeAnom">0</span></button>
      <button class="nav-item" data-view="verify" type="button"><span class="ni-icon">✓</span> Verify</button>'

$new = '<button class="nav-item" data-view="anomalies" type="button"><span class="ni-icon">⚠</span> Anomalies <span class="badge" id="badgeAnom">0</span></button>
      <button class="nav-item" data-view="history" type="button"><span class="ni-icon">⏱</span> Time Machine</button>
      <button class="nav-item" data-view="verify" type="button"><span class="ni-icon">✓</span> Verify</button>'

if (-not $t.Contains($old)) { Write-Output 'NAV_OLD_NOT_FOUND'; exit 1 }
$t = $t.Replace($old, $new)
[IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
Write-Output 'NAV_PATCHED'
