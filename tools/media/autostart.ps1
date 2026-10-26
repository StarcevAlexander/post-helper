param(
  [Parameter(Position = 0)]
  [ValidateSet('install', 'uninstall', 'status')]
  [string]$Action = 'status'
)

$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
& (Join-Path $Repo 'tools\hidden-task.ps1') $Action -TaskName 'PostHelperMediaWorker' -Script (Join-Path $PSScriptRoot 'worker.mjs') -Log (Join-Path $PSScriptRoot 'worker.log') -Repo $Repo
exit $LASTEXITCODE
