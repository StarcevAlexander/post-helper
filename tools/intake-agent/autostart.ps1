param(
  [Parameter(Position = 0)]
  [ValidateSet('install', 'uninstall', 'status')]
  [string]$Action = 'status'
)

$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
& (Join-Path $Repo 'tools\hidden-task.ps1') $Action -TaskName 'PostHelperIntakeAgent' -Script (Join-Path $PSScriptRoot 'watch.mjs') -Log (Join-Path $PSScriptRoot 'agent.log') -Repo $Repo
exit $LASTEXITCODE
