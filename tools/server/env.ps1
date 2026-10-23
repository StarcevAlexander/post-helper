$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvFile = Join-Path $Repo 'server\.env'
$OwnerEnvFile = Join-Path $Repo 'tools\owner\.env'
$DbUrlFile = 'C:\post-helper-db\database-url.txt'
$Keys = @(
  @{ Name = 'ANTHROPIC_API_KEY'; Secret = $true; Generate = 0 },
  @{ Name = 'ACCESS_PASSWORD'; Secret = $true; Generate = 28 },
  @{ Name = 'AGENT_TOKEN'; Secret = $true; Generate = 32 },
  @{ Name = 'TELEGRAM_BOT_TOKEN'; Secret = $true; Generate = 0 },
  @{ Name = 'TELEGRAM_CHAT_ID'; Secret = $false; Generate = 0 }
)

function New-Secret($length) {
  $chars = (48..57) + (65..90) + (97..122)
  -join ($chars | Get-Random -Count $length | ForEach-Object { [char]$_ })
}

$values = [ordered]@{}
if (Test-Path $EnvFile) {
  foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*?)\s*$') { $values[$Matches[1]] = $Matches[2] }
  }
}

if (-not $values['DATABASE_URL'] -and (Test-Path $DbUrlFile)) {
  $values['DATABASE_URL'] = (Get-Content $DbUrlFile -Raw).Trim()
  Write-Output "DATABASE_URL taken from $DbUrlFile"
}

foreach ($key in $Keys) {
  $current = $values[$key.Name]
  if ($current) {
    $hint = "set, $($current.Length) chars; Enter keeps it"
  } elseif ($key.Generate -gt 0) {
    $hint = 'empty; Enter generates a random one'
  } else {
    $hint = 'empty; Enter skips it'
  }
  $prompt = "$($key.Name) ($hint)"
  if ($key.Secret) {
    $secure = Read-Host -Prompt $prompt -AsSecureString
    $typed = [System.Net.NetworkCredential]::new('', $secure).Password
  } else {
    $typed = Read-Host -Prompt $prompt
  }
  if ($typed) {
    $values[$key.Name] = $typed
  } elseif (-not $current -and $key.Generate -gt 0) {
    $values[$key.Name] = New-Secret $key.Generate
    Write-Output "$($key.Name) generated"
  }
}

$lines = $values.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }
Set-Content -Path $EnvFile -Value $lines -Encoding ascii

if ($values['ACCESS_PASSWORD'] -and -not (Test-Path $OwnerEnvFile)) {
  Set-Content -Path $OwnerEnvFile -Value @('OWNER_SERVER=http://127.0.0.1:8080', "OWNER_PASSWORD=$($values['ACCESS_PASSWORD'])") -Encoding ascii
  Write-Output "Created $OwnerEnvFile for the owner commands"
}

Write-Output "Saved $EnvFile with $($values.Count) values:"
$values.GetEnumerator() | ForEach-Object { Write-Output "  $($_.Key): $($_.Value.Length) chars" }
