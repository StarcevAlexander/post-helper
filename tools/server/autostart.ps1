param(
  [Parameter(Position = 0)]
  [ValidateSet('install', 'uninstall', 'status')]
  [string]$Action = 'status'
)

$TaskName = 'PostHelperServer'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ServerDir = Join-Path $Repo 'server'
$Exe = Join-Path $ServerDir 'post-helper.exe'
$Log = Join-Path $ServerDir 'server.log'

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
  try {
    $code = (Invoke-WebRequest -Uri 'http://127.0.0.1:8080/healthz' -UseBasicParsing -TimeoutSec 5).StatusCode
    Write-Output "healthz: $code"
  } catch {
    Write-Output 'healthz: no answer'
  }
  return
}

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  throw 'Run PowerShell as Administrator: the task must start at boot, before anyone logs in.'
}

Push-Location $ServerDir
try {
  & go build -o $Exe .
  if ($LASTEXITCODE -ne 0) { throw 'go build failed' }
} finally {
  Pop-Location
}

$command = "/c `"`"$Exe`" >> `"$Log`" 2>&1`""
$taskAction = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $command -WorkingDirectory $ServerDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Output "Task $TaskName installed: starts at boot, log: $Log"
