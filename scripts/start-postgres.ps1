$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$pgBin = 'C:\Program Files\PostgreSQL\17\bin'
$cluster = Join-Path $projectRoot 'bridge\.data\postgres'
if (-not (Test-Path -LiteralPath (Join-Path $cluster 'PG_VERSION'))) {
    & (Join-Path $pgBin 'initdb.exe') -D $cluster -U lantern --auth=trust --encoding=UTF8 --no-locale
    if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the local PostgreSQL cluster.' }
}
& (Join-Path $pgBin 'pg_ctl.exe') -D $cluster status | Out-Null
if ($LASTEXITCODE -ne 0) {
    & (Join-Path $pgBin 'pg_ctl.exe') -D $cluster -l (Join-Path $cluster 'server.log') -o '-p 55432 -h 127.0.0.1' -w start
    if ($LASTEXITCODE -ne 0) { throw 'Could not start the local PostgreSQL cluster.' }
}
$databaseExists = & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p 55432 -U lantern -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='lantern'"
if ($databaseExists -ne '1') {
    & (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p 55432 -U lantern lantern
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the LANTERN database.' }
}
Write-Host 'Local development PostgreSQL ready at 127.0.0.1:55432 (loopback only).'
