$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$server = Join-Path $repo 'server'
$exe = Join-Path $server 'post-helper.exe'
$fresh = Join-Path $server 'post-helper.new.exe'
$base = 'http://127.0.0.1:8080'
$task = 'PostHelperServer'

function Test-Health {
  try { return (Invoke-WebRequest "$base/healthz" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 204 } catch { return $false }
}

Push-Location $server
try {
  go build -o $fresh .
  if ($LASTEXITCODE -ne 0) { throw 'build failed' }

  $running = Get-Process -Name 'post-helper' -ErrorAction SilentlyContinue
  if ($running) {
    $line = Get-Content (Join-Path $server '.env') | Where-Object { $_ -match '^ACCESS_PASSWORD=' } | Select-Object -First 1
    $password = ($line -replace '^ACCESS_PASSWORD=', '').Trim('"', "'", ' ')
    try {
      Invoke-RestMethod "$base/api/admin/shutdown" -Method Post -Headers @{ Authorization = "Bearer $password" } | Out-Null
    } catch {
      Write-Output 'The running server has no shutdown endpoint (ADMIN_RESTART=1 is missing or the build is old).'
      Write-Output 'Stop it once as administrator: Stop-Process -Name post-helper -Force. The new build is ready in server\post-helper.new.exe.'
      exit 2
    }
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Process -Name 'post-helper' -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
    if (Get-Process -Name 'post-helper' -ErrorAction SilentlyContinue) { throw 'the server did not stop in 20 seconds' }
  }

  Copy-Item $fresh $exe -Force
  Remove-Item $fresh -Force
  Start-ScheduledTask -TaskName $task

  $deadline = (Get-Date).AddSeconds(20)
  while (-not (Test-Health) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Health)) { throw 'the server did not answer /healthz in 20 seconds' }
  Write-Output "Server restarted, PID $((Get-Process -Name 'post-helper').Id), /healthz 204"
} finally {
  Pop-Location
}
