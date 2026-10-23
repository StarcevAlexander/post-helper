param(
  [Parameter(Position = 0)]
  [ValidateSet('run', 'install', 'uninstall', 'status')]
  [string]$Action = 'run',
  [string]$Dir = 'C:\post-helper-backups',
  [int]$Keep = 14
)

$TaskName = 'PostHelperBackup'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvFile = Join-Path $Repo 'server\.env'

function Get-DatabaseUrl {
  if (-not (Test-Path $EnvFile)) { throw "No $EnvFile" }
  foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*DATABASE_URL\s*=\s*(.*?)\s*$') {
      return $Matches[1].Trim('"', "'")
    }
  }
  throw 'DATABASE_URL is not set in server\.env'
}

function Find-PgDump {
  $found = Get-Command pg_dump -ErrorAction SilentlyContinue
  if ($found) { return $found.Source }
  $local = 'C:\post-helper-db\env\Library\bin\pg_dump.exe'
  if (Test-Path $local) { return $local }
  $candidate = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\pg_dump.exe' -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  if ($candidate) { return $candidate.FullName }
  throw 'pg_dump not found: install PostgreSQL first'
}

if ($Action -eq 'uninstall') {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Task $TaskName removed"
  return
}

if ($Action -eq 'status') {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Output "Task ${TaskName}: state $($task.State), last run $($info.LastRunTime), last result $($info.LastTaskResult)"
  } else {
    Write-Output "Task $TaskName is not installed"
  }
  $files = Get-ChildItem $Dir -Filter 'post-helper-*.dump' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
  Write-Output "Backups in ${Dir}: $(@($files).Count), newest: $($files | Select-Object -First 1 -ExpandProperty Name)"
  return
}

if ($Action -eq 'install') {
  $script = Join-Path $PSScriptRoot 'backup.ps1'
  $argument = "-NoProfile -ExecutionPolicy Bypass -File `"$script`" run -Dir `"$Dir`" -Keep $Keep"
  $taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument
  $trigger = New-ScheduledTaskTrigger -Daily -At '04:00'
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Write-Output "Task $TaskName installed: daily at 04:00, folder: $Dir, keeps $Keep"
  return
}

New-Item -ItemType Directory -Force $Dir | Out-Null
$target = Join-Path $Dir ("post-helper-{0}.dump" -f (Get-Date -Format 'yyyyMMdd-HHmm'))
& (Find-PgDump) --format=custom --file $target --dbname (Get-DatabaseUrl)
if ($LASTEXITCODE -ne 0) {
  Remove-Item $target -ErrorAction SilentlyContinue
  throw 'pg_dump failed'
}
Get-ChildItem $Dir -Filter 'post-helper-*.dump' | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep | Remove-Item
Write-Output "Backup saved: $target ($([math]::Round((Get-Item $target).Length / 1KB)) KB)"
