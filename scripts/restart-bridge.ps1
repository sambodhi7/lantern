$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$bridge = Join-Path $root 'bridge\server.mjs'
$bundledNode = 'C:\Users\SAMBODHI\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$node = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node -ErrorAction Stop).Source }

Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($bridge) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Start-Process -FilePath $node -ArgumentList @('"' + $bridge + '"') -WorkingDirectory $root -RedirectStandardOutput (Join-Path $root 'bridge\server.log') -RedirectStandardError (Join-Path $root 'bridge\server.err.log') -WindowStyle Hidden | Out-Null
Start-Sleep -Seconds 1
$health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 5
Write-Host "Conversion bridge running. Provider configured: $($health.configured)"
