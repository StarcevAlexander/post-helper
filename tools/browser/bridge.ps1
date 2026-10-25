param(
  [Parameter(Position = 0)]
  [ValidateSet('check', 'fix', 'run', 'install', 'uninstall', 'status')]
  [string]$Action = 'check',
  [string]$Profile = 'Default'
)

$TaskName = 'PostHelperBrowserBridge'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Log = Join-Path $PSScriptRoot 'bridge.log'
$StateFile = Join-Path $PSScriptRoot 'state.json'
$ExtensionId = 'fcoeoabgfenejglbffodgkkbkcdhcgfn'
$HostName = 'com.anthropic.claude_code_browser_extension'
$ChromeProfile = $Profile
$ProbeTimeoutSeconds = 90
$ChromeStartSeconds = 30
$IdleMinutesForRestart = 30
$RepeatAlertHours = 12
$CheckEveryMinutes = 60
$FixCommand = 'powershell -File tools\browser\bridge.ps1 fix'

$Probe = 'Call the tool mcp__claude-in-chrome__tabs_context_mcp exactly once. Reply with the single word FAIL followed by the error text only if the tool is missing or its answer says the browser or the extension is not connected, unavailable or timed out. Any other tool answer, including a message about a tab group, means success: reply with the single word OK.'

function Write-Log($text) {
  Add-Content -Path $Log -Value ('{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text) -Encoding UTF8
}

function Say($text) {
  Write-Output $text
  Write-Log $text
}

function Get-Claude {
  $local = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
  if (Test-Path $local) { return $local }
  $command = Get-Command claude -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  return $null
}

function Get-Chrome {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  )
  foreach ($candidate in $candidates) { if (Test-Path $candidate) { return $candidate } }
  $registered = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -ErrorAction SilentlyContinue).'(default)'
  if ($registered -and (Test-Path $registered)) { return $registered }
  return $null
}

function Get-ChromeMain {
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' }
}

function Test-Tunnel {
  $adapter = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'happ-*' -and $_.Status -eq 'Up' }
  if (-not $adapter) { return $false }
  try {
    Invoke-WebRequest -Uri 'https://claude.ai/' -Method Head -UseBasicParsing -TimeoutSec 8 | Out-Null
    return $true
  } catch [System.Net.WebException] {
    return ($null -ne $_.Exception.Response)
  } catch {
    return $false
  }
}

function Get-IdleMinutes {
  if (-not ('PostHelper.Idle' -as [type])) {
    Add-Type -Namespace PostHelper -Name Idle -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)]
public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
[DllImport("user32.dll")]
public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
'@
  }
  $info = New-Object PostHelper.Idle+LASTINPUTINFO
  $info.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($info)
  if (-not [PostHelper.Idle]::GetLastInputInfo([ref]$info)) { return 0 }
  return [math]::Floor(([Environment]::TickCount - $info.dwTime) / 60000)
}

function Get-StaticProblems {
  $problems = @()
  if (-not (Get-Claude)) { $problems += 'claude.exe not found (install Claude Code)' }
  $manifest = (Get-ItemProperty "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName" -ErrorAction SilentlyContinue).'(default)'
  if (-not $manifest) {
    $problems += 'native host is not registered in Chrome (run claude, then /chrome, and pick install)'
  } elseif (-not (Test-Path $manifest)) {
    $problems += "native host manifest is missing: $manifest"
  } else {
    $hostPath = (Get-Content $manifest -Raw | ConvertFrom-Json).path
    if (-not (Test-Path $hostPath)) { $problems += "native host launcher is missing: $hostPath" }
  }
  $extension = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data\$ChromeProfile\Extensions\$ExtensionId"
  if (-not (Test-Path $extension)) { $problems += "Claude in Chrome extension is not installed in profile $ChromeProfile" }
  if (-not (Get-Chrome)) { $problems += 'chrome.exe not found' }
  return $problems
}

function Start-Chrome($reason) {
  $chrome = Get-Chrome
  if (-not $chrome) { return $false }
  Start-Process -FilePath $chrome -ArgumentList "--profile-directory=$ChromeProfile", '--restore-last-session'
  Say "Chrome started ($reason), waiting $ChromeStartSeconds s"
  Start-Sleep -Seconds $ChromeStartSeconds
  return $true
}

function Restart-Chrome($reason) {
  Say "restarting Chrome ($reason)"
  Get-ChromeMain | ForEach-Object { (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).CloseMainWindow() | Out-Null }
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline -and (Get-Process -Name chrome -ErrorAction SilentlyContinue)) { Start-Sleep -Seconds 1 }
  Get-Process -Name chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  return (Start-Chrome 'after restart')
}

function Invoke-Probe {
  $claude = Get-Claude
  if (-not $claude) { return @{ ok = $false; detail = 'claude.exe not found' } }
  $out = Join-Path $env:TEMP "ph-bridge-$PID.json"
  $err = Join-Path $env:TEMP "ph-bridge-$PID.err"
  $env:CLAUDECODE = $null
  $arguments = @('-p', "`"$Probe`"", '--chrome', '--restricted', '--model', 'haiku', '--max-turns', '3', '--tools', 'mcp__claude-in-chrome__tabs_context_mcp', '--allowedTools', 'mcp__claude-in-chrome__tabs_context_mcp', '--disable-slash-commands', '--strict-mcp-config', '--output-format', 'json')
  $process = Start-Process -FilePath $claude -ArgumentList $arguments -WorkingDirectory $env:TEMP -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  if (-not $process.WaitForExit($ProbeTimeoutSeconds * 1000)) {
    $process.Kill()
    Remove-Item $out, $err -ErrorAction SilentlyContinue
    return @{ ok = $false; detail = "probe did not finish in $ProbeTimeoutSeconds s" }
  }
  $text = if (Test-Path $out) { Get-Content $out -Raw -Encoding UTF8 } else { '' }
  $errors = if (Test-Path $err) { (Get-Content $err -Raw -Encoding UTF8) } else { '' }
  Remove-Item $out, $err -ErrorAction SilentlyContinue
  try {
    $result = ($text | ConvertFrom-Json).result
  } catch {
    $detail = ("claude exited with code $($process.ExitCode): " + ($text + ' ' + $errors).Trim()) -replace '\s+', ' '
    return @{ ok = $false; detail = $detail.Substring(0, [Math]::Min(300, $detail.Length)) }
  }
  if ($result -match '^\s*OK\b') { return @{ ok = $true; detail = 'extension answered' } }
  return @{ ok = $false; detail = ($result -replace '\s+', ' ').Trim() }
}

function Read-State {
  if (Test-Path $StateFile) {
    try { return Get-Content $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
  }
  return [pscustomobject]@{ status = 'unknown'; since = $null; lastCheck = $null; lastAlert = $null; detail = '' }
}

function Save-State($state) {
  $state | ConvertTo-Json | Set-Content $StateFile -Encoding UTF8
}

function Send-Telegram($text) {
  $envFile = Join-Path $Repo 'server\.env'
  if (-not (Test-Path $envFile)) { Write-Log 'telegram: server\.env not found, message not sent'; return $false }
  $values = @{}
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*?)\s*$') { $values[$matches[1]] = $matches[2].Trim('"') }
  }
  $token = $values['TELEGRAM_BOT_TOKEN']
  $chat = $values['TELEGRAM_CHAT_ID']
  if (-not $token -or -not $chat) { Write-Log 'telegram: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is empty, message not sent'; return $false }
  try {
    Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/sendMessage" -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes((@{ chat_id = $chat; text = $text } | ConvertTo-Json -Compress))) -TimeoutSec 20 | Out-Null
    Write-Log 'telegram: sent'
    return $true
  } catch {
    Write-Log "telegram: failed: $($_.Exception.Message)"
    return $false
  }
}

function Get-Verdict {
  $problems = Get-StaticProblems
  if ($problems.Count -gt 0) { return @{ ok = $false; detail = ($problems -join '; '); static = $true } }
  if (-not (Get-ChromeMain)) { return @{ ok = $false; detail = 'Chrome is not running'; chromeDown = $true } }
  $probe = Invoke-Probe
  return @{ ok = $probe.ok; detail = $probe.detail }
}

function Show-Verdict($verdict) {
  if ($verdict.ok) { Say 'bridge OK: Claude Code reaches the Chrome extension' } else { Say "bridge BROKEN: $($verdict.detail)" }
}

function Repair($verdict, $allowRestart) {
  if ($verdict.static) { return $verdict }
  if ($verdict.chromeDown) {
    if (Start-Chrome 'not running') { $verdict = Get-Verdict }
    if ($verdict.ok) { return $verdict }
  }
  if (-not $allowRestart) { return $verdict }
  if (Restart-Chrome $verdict.detail) { $verdict = Get-Verdict }
  return $verdict
}

function Update-State($verdict, $alert) {
  $state = Read-State
  $now = (Get-Date).ToString('s')
  $status = if ($verdict.ok) { 'ok' } else { 'broken' }
  $changed = $state.status -ne $status
  $repeat = $state.lastAlert -and ((Get-Date) - [datetime]$state.lastAlert).TotalHours -ge $RepeatAlertHours
  if ($alert -and -not $verdict.ok -and ($changed -or $repeat)) {
    if (Send-Telegram "Связка Chrome и Claude Code сломана: $($verdict.detail). Команды /content-plan и /content-review без неё не увидят страницы. Починка: $FixCommand (перезапустит Chrome). Если не помогло: в Claude Code выполнить /chrome и переустановить расширение Claude in Chrome.") { $state.lastAlert = $now }
  }
  if ($alert -and $verdict.ok -and $state.status -eq 'broken') {
    Send-Telegram 'Связка Chrome и Claude Code снова работает.' | Out-Null
    $state.lastAlert = $null
  }
  if ($changed) { $state.since = $now }
  $state.status = $status
  $state.lastCheck = $now
  $state.detail = $verdict.detail
  Save-State $state
}

switch ($Action) {
  'check' {
    $verdict = Get-Verdict
    Show-Verdict $verdict
    Update-State $verdict $false
    if (-not $verdict.ok) { Write-Output "fix: $FixCommand"; exit 1 }
  }
  'fix' {
    $verdict = Get-Verdict
    Show-Verdict $verdict
    if (-not $verdict.ok) {
      $verdict = Repair $verdict $true
      Show-Verdict $verdict
    }
    Update-State $verdict $true
    if (-not $verdict.ok) { exit 1 }
  }
  'run' {
    if (-not (Test-Tunnel)) { Write-Log 'tunnel is down, check skipped (the Happ start script handles the tunnel)'; exit 0 }
    $verdict = Get-Verdict
    if (-not $verdict.ok) {
      $idle = Get-IdleMinutes
      $verdict = Repair $verdict ($idle -ge $IdleMinutesForRestart)
      if (-not $verdict.ok -and -not $verdict.static -and $idle -lt $IdleMinutesForRestart) { Write-Log "owner is active (idle $idle min), Chrome left untouched" }
    }
    Write-Log $(if ($verdict.ok) { 'bridge OK' } else { "bridge BROKEN: $($verdict.detail)" })
    Update-State $verdict $true
  }
  'install' {
    $argument = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" run"
    $taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument -WorkingDirectory $Repo
    $atLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $atLogon.Delay = 'PT5M'
    $hourly = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes $CheckEveryMinutes)
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger @($atLogon, $hourly) -Settings $settings -Force | Out-Null
    Write-Output "Task $TaskName installed: checks the bridge every $CheckEveryMinutes min and 5 min after logon, without a window. Log: $Log"
  }
  'uninstall' {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output "Task $TaskName removed"
  }
  'status' {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
      $info = Get-ScheduledTaskInfo -TaskName $TaskName
      Write-Output "Task ${TaskName}: state $($task.State), last run $($info.LastRunTime), last result $($info.LastTaskResult), next run $($info.NextRunTime)"
    } else {
      Write-Output "Task $TaskName is not installed"
    }
    $state = Read-State
    Write-Output "bridge: $($state.status) since $($state.since), last check $($state.lastCheck) $($state.detail)"
    if (Test-Path $Log) { Get-Content $Log -Tail 5 -Encoding UTF8 }
  }
}
