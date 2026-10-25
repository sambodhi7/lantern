$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
if (Test-Path -LiteralPath (Join-Path $bundledNode 'node.exe')) {
    $env:PATH = "$bundledNode;$env:PATH"
}
$nodeVersion = (& node --version).TrimStart('v').Split('.')[0]
if ([int]$nodeVersion -lt 22) {
    throw 'Node.js 22.13 or newer is required for Hardhat 3.'
}
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot '..\node_modules\hardhat'))) {
    npm ci
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
npm run demo
exit $LASTEXITCODE
