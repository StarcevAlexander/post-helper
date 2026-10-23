$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$DbRoot = 'C:\post-helper-db'
$Bin = "$DbRoot\env\Library\bin"
$EnvFile = Join-Path $Repo 'server\.env'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  throw 'Run this script as Administrator.'
}

$text = if (Test-Path $EnvFile) { Get-Content $EnvFile -Raw } else { '' }
foreach ($key in 'ANTHROPIC_API_KEY', 'ACCESS_PASSWORD', 'DATABASE_URL') {
  if ($text -notmatch "(?m)^\s*$key\s*=\s*\S") {
    throw "server\.env has no $key. Run: powershell -File tools\server\env.ps1"
  }
}

Write-Output 'Step 1/5: database starts at boot'
$pgCtl = Join-Path $Bin 'pg_ctl.exe'
if (Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue) {
  & $pgCtl -D "$DbRoot\data" -m fast -w stop | Out-Null
}
$action = New-ScheduledTaskAction -Execute (Join-Path $Bin 'postgres.exe') -Argument "-D `"$DbRoot\data`"" -WorkingDirectory $DbRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
Register-ScheduledTask -TaskName 'PostHelperPostgres' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName 'PostHelperPostgres'
for ($i = 0; $i -lt 30; $i++) {
  if (Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue) { break }
  Start-Sleep 1
}
if (-not (Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue)) {
  throw 'Database did not start in 30 seconds. See C:\post-helper-db\data\log'
}

Write-Output 'Step 2/5: server starts at boot'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'autostart.ps1') install

Write-Output 'Step 3/5: daily database backup'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'backup.ps1') install

Write-Output 'Step 4/5: no sleep, no hibernation'
powercfg /change standby-timeout-ac 0
powercfg /hibernate off

Write-Output 'Step 5/5: Tailscale'
if (-not (Get-Command tailscale -ErrorAction SilentlyContinue) -and -not (Test-Path 'C:\Program Files\Tailscale\tailscale.exe')) {
  winget install -e --id Tailscale.Tailscale --silent --accept-package-agreements --accept-source-agreements
} else {
  Write-Output 'Tailscale is already installed'
}

Start-Sleep 5
try {
  $code = (Invoke-WebRequest -Uri 'http://127.0.0.1:8080/healthz' -UseBasicParsing -TimeoutSec 10).StatusCode
  Write-Output "Server healthz: $code"
} catch {
  Write-Output 'Server healthz: no answer yet, check server\server.log'
}
Write-Output 'Done. Next: sign in to Tailscale and enable Funnel (docs\owner\home-server.md, step 7).'
