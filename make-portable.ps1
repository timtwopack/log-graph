param(
  [string]$OutputDir = (Join-Path $PSScriptRoot 'dist'),
  [switch]$IncludeSamples
)

$ErrorActionPreference = 'Stop'

$BuildScript = Join-Path $PSScriptRoot 'tools\build.mjs'
if (Test-Path $BuildScript) {
  $Node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $Node) {
    throw "Node.js is required to build a fresh portable bundle. Run npm run build on a dev machine first, or install Node.js."
  }
  & $Node.Source $BuildScript
  if ($LASTEXITCODE -ne 0) { throw "Build failed" }
}

$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BundleName = "pa-graph-portable-$Stamp"
$BundleDir = Join-Path $OutputDir $BundleName
$ZipPath = Join-Path $OutputDir "$BundleName.zip"
$ServerDir = Join-Path $PSScriptRoot 'dist\server'

if (Test-Path $BundleDir) { Remove-Item -LiteralPath $BundleDir -Recurse -Force }
New-Item -ItemType Directory -Path $BundleDir | Out-Null

if (-not (Test-Path (Join-Path $ServerDir 'log-graph-v091.html'))) {
  throw "dist\server is missing. Run npm run build first."
}

Get-ChildItem -LiteralPath $ServerDir -Force | Copy-Item -Destination $BundleDir -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'serve-local.ps1') -Destination (Join-Path $BundleDir 'serve-local.ps1')

if ($IncludeSamples) {
  New-Item -ItemType Directory -Path (Join-Path $BundleDir 'data_base') | Out-Null
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'data_base\test_base.txt') -Destination (Join-Path $BundleDir 'data_base\test_base.txt')
}

if (Test-Path $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
Compress-Archive -LiteralPath (Join-Path $BundleDir '*') -DestinationPath $ZipPath -Force

Write-Host "Portable folder: $BundleDir"
Write-Host "Portable zip   : $ZipPath"
Write-Host ""
Write-Host "Run after unpacking:"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\serve-local.ps1"
