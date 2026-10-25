param(
  [Parameter(Mandatory, Position = 0)]
  [ValidateSet('run', 'install', 'uninstall', 'status')]
  [string]$Action,
  [Parameter(Mandatory)]
  [string]$TaskName,
  [Parameter(Mandatory)]
  [string]$Script,
  [Parameter(Mandatory)]
  [string]$Log,
  [string]$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [int]$KeepAliveMinutes = 5
)

function Get-ScriptProcess {
  $pattern = [regex]::Escape($Script)
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match $pattern }
}

if ($Action -eq 'run') {
  $node = (Get-Command node -ErrorAction Stop).Source
  $command = "/c `"`"$node`" `"$Script`" >> `"$Log`" 2>&1`""
  $process = Start-Process -FilePath 'cmd.exe' -ArgumentList $command -WorkingDirectory $Repo -WindowStyle Hidden -PassThru -Wait
  exit $process.ExitCode
}

if ($Action -eq 'uninstall') {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Get-ScriptProcess | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
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

$argument = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" run -TaskName `"$TaskName`" -Script `"$Script`" -Log `"$Log`" -Repo `"$Repo`""
$taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument -WorkingDirectory $Repo
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$keepAlive = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $KeepAliveMinutes)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger @($atLogon, $keepAlive) -Settings $settings -Force | Out-Null
if (-not (Get-ScriptProcess)) { Start-ScheduledTask -TaskName $TaskName }
Write-Output "Task $TaskName installed: runs at logon without a window, keep-alive check every $KeepAliveMinutes min. Log: $Log"
