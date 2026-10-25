$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$bundledNode = 'C:\Users\SAMBODHI\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$node = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node -ErrorAction Stop).Source }
if (Test-Path -LiteralPath (Join-Path $root 'bridge\.data\postgres\PG_VERSION')) { & (Join-Path $PSScriptRoot 'start-postgres.ps1') }

function Test-LocalPage([string]$url) {
    try { return (Invoke-WebRequest -UseBasicParsing -NoProxy -SkipHttpErrorCheck $url -TimeoutSec 3).StatusCode -eq 200 }
    catch { return $false }
}

if (-not (Test-LocalPage 'http://127.0.0.1:8787/health')) {
    Start-Process -FilePath $node -ArgumentList @('"' + (Join-Path $root 'bridge\server.mjs') + '"') -WorkingDirectory $root -RedirectStandardOutput (Join-Path $root 'bridge\server.log') -RedirectStandardError (Join-Path $root 'bridge\server.err.log') -WindowStyle Hidden | Out-Null
}
if (-not (Test-LocalPage 'http://127.0.0.1:5173/')) {
    $frontend = Join-Path $root 'frontend'
    $vite = Join-Path $frontend 'node_modules\vite\bin\vite.js'
    if (-not (Test-Path -LiteralPath $vite)) { throw 'Frontend packages are missing. Run npm ci in frontend first.' }
    Start-Process -FilePath $node -ArgumentList @('"' + $vite + '"', '--host', '127.0.0.1', '--port', '5173', '--strictPort') -WorkingDirectory $frontend -RedirectStandardOutput (Join-Path $frontend 'dev-server.log') -RedirectStandardError (Join-Path $frontend 'dev-server.err.log') -WindowStyle Hidden | Out-Null
}

Start-Sleep -Seconds 1
if (-not (Test-LocalPage 'http://127.0.0.1:8787/health')) { throw 'Conversion bridge did not start. Check bridge/server.err.log.' }
if (-not (Test-LocalPage 'http://127.0.0.1:5173/')) { throw 'Frontend did not start. Check frontend/dev-server.err.log.' }
Write-Host 'LANTERN is running at http://127.0.0.1:5173/'
