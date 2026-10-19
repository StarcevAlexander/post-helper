param(
  [Parameter(Position = 0)]
  [ValidateSet('install', 'uninstall', 'status')]
  [string]$Action = 'status'
)

$TaskName = 'PostHelperRefsWorker'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Log = Join-Path $Repo 'tools\refs\worker.log'

if ($Action -eq 'uninstall') {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Task $TaskName removed"
  return
}

if ($Action -eq 'status') {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $task) { Write-Output "Task $TaskName is not installed"; return }
  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Output "Task ${TaskName}: state $($task.State), last run $($info.LastRunTime), last result $($info.LastTaskResult)"
  return
}

$node = (Get-Command node -ErrorAction Stop).Source
$worker = Join-Path $Repo 'tools\refs\worker.mjs'
$command = "/c `"`"$node`" `"$worker`" >> `"$Log`" 2>&1`""
$taskAction = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $command -WorkingDirectory $Repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Output "Task $TaskName installed: starts at logon, log: $Log"
