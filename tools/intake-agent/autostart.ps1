param(
  [Parameter(Position = 0)]
  [ValidateSet('install', 'uninstall', 'status')]
  [string]$Action = 'status'
)

$TaskName = 'PostHelperIntakeAgent'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Script = Join-Path $PSScriptRoot 'watch.mjs'
$Log = Join-Path $PSScriptRoot 'agent.log'

if ($Action -eq 'uninstall') {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Task $TaskName removed"
  return
}

if ($Action -eq 'status') {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $task) { Write-Output "Task $TaskName is not installed"; return }
  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Output "Task ${TaskName}: state $($task.State), last run $($info.LastRunTime), last result $($info.LastTaskResult)"
  if (Test-Path $Log) { Get-Content $Log -Tail 5 }
  return
}

$node = (Get-Command node -ErrorAction Stop).Source
$command = "/c `"`"$node`" `"$Script`" >> `"$Log`" 2>&1`""
$taskAction = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $command -WorkingDirectory $Repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Output "Task $TaskName installed and started. Log: $Log"
