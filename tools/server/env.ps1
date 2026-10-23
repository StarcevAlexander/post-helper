$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvFile = Join-Path $Repo 'server\.env'
$Keys = @(
  @{ Name = 'ANTHROPIC_API_KEY'; Secret = $true },
  @{ Name = 'ACCESS_PASSWORD'; Secret = $true },
  @{ Name = 'DATABASE_URL'; Secret = $true },
  @{ Name = 'AGENT_TOKEN'; Secret = $true },
  @{ Name = 'TELEGRAM_BOT_TOKEN'; Secret = $true },
  @{ Name = 'TELEGRAM_CHAT_ID'; Secret = $false }
)

$values = [ordered]@{}
if (Test-Path $EnvFile) {
  foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*?)\s*$') { $values[$Matches[1]] = $Matches[2] }
  }
}

foreach ($key in $Keys) {
  $current = $values[$key.Name]
  $state = if ($current) { "set, $($current.Length) chars; Enter keeps it" } else { 'empty; Enter skips it' }
  $prompt = "$($key.Name) ($state)"
  if ($key.Secret) {
    $secure = Read-Host -Prompt $prompt -AsSecureString
    $typed = [System.Net.NetworkCredential]::new('', $secure).Password
  } else {
    $typed = Read-Host -Prompt $prompt
  }
  if ($typed) { $values[$key.Name] = $typed }
}

$lines = $values.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }
Set-Content -Path $EnvFile -Value $lines -Encoding ascii
Write-Output "Saved $EnvFile with $($values.Count) values:"
$values.GetEnumerator() | ForEach-Object { Write-Output "  $($_.Key): $($_.Value.Length) chars" }
