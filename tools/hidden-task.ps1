param(
  [Parameter(Mandatory, Position = 0)]
  [ValidateSet('install', 'uninstall', 'status')]
  [string]$Action,
  [Parameter(Mandatory)]
  [string]$TaskName,
  [Parameter(Mandatory)]
  [string]$Script,
  [Parameter(Mandatory)]
  [string]$Log,
  [Parameter(Mandatory)]
  [string]$Repo,
  [int]$KeepAliveMinutes = 5,
  [string]$Arguments = ''
)

$Launcher = Join-Path $Repo 'tools\bin\background.exe'
$PidFile = "$Log.pid"

function Get-ScriptProcess {
  $pattern = [regex]::Escape($Script)
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match $pattern }
}

if ($Action -eq 'uninstall') {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Get-ScriptProcess | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Remove-Item $PidFile -ErrorAction SilentlyContinue
  Write-Output "Task $TaskName removed, process stopped"
  return
}

if ($Action -eq 'status') {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $task) { Write-Output "Task $TaskName is not installed"; exit 2 }
  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Output "Task ${TaskName}: state $($task.State), last run $($info.LastRunTime), last result $($info.LastTaskResult), next keep-alive check $($info.NextRunTime)"
  $alive = @(Get-ScriptProcess)
  if ($alive.Count -gt 0) {
    Write-Output "process: running (pid $($alive[0].ProcessId), since $($alive[0].CreationDate))"
  } else {
    Write-Output 'process: NOT running, the keep-alive trigger restarts it within a few minutes; run install to start it now'
  }
  if (Test-Path $Log) { Get-Content $Log -Tail 5 -Encoding UTF8 }
  if ($alive.Count -eq 0) { exit 1 }
  return
}

Push-Location (Join-Path $Repo 'server')
try {
  go build -ldflags '-H=windowsgui' -o $Launcher ./cmd/background
  if ($LASTEXITCODE -ne 0) { throw 'could not build tools\bin\background.exe' }
} finally {
  Pop-Location
}

$node = (Get-Command node -ErrorAction Stop).Source
$alive = @(Get-ScriptProcess)
if ($alive.Count -gt 0) {
  $started = ([DateTimeOffset]$alive[0].CreationDate).ToUnixTimeMilliseconds() * 1000000
  Set-Content -Path $PidFile -Value "$($alive[0].ProcessId) $started" -Encoding ASCII
}

$argument = "-node `"$node`" -script `"$Script`" -log `"$Log`" -dir `"$Repo`""
if ($Arguments) { $argument += " -args `"$Arguments`"" }
$taskAction = New-ScheduledTaskAction -Execute $Launcher -Argument $argument -WorkingDirectory $Repo
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$keepAlive = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $KeepAliveMinutes)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger @($atLogon, $keepAlive) -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Output "Task $TaskName installed: runs at logon with no window at all, keeps the script alive and checks every $KeepAliveMinutes min. Log: $Log"
