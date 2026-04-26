param(
  [string]$OutputDir = (Join-Path $PSScriptRoot 'dist'),
  [switch]$NoZip
)

$ErrorActionPreference = 'Stop'

$Node = Get-Command node -ErrorAction SilentlyContinue
if (-not $Node) {
  throw "Node.js is required to build the project before archiving it to dist."
}

& $Node.Source (Join-Path $PSScriptRoot 'tools\build.mjs')
if ($LASTEXITCODE -ne 0) { throw "Build failed" }

$BuildDir = Join-Path $PSScriptRoot 'build'
if (-not (Test-Path (Join-Path $BuildDir 'index.html'))) {
  throw "build\index.html is missing after build."
}

$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Name = "log-graph-build-$Stamp"
$TargetDir = Join-Path $OutputDir $Name
$ZipPath = Join-Path $OutputDir "$Name.zip"

if (Test-Path $TargetDir) { Remove-Item -LiteralPath $TargetDir -Recurse -Force }
New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null

Get-ChildItem -LiteralPath $BuildDir -Force | Copy-Item -Destination $TargetDir -Recurse -Force

if (-not $NoZip) {
  if (Test-Path $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
  $Items = Get-ChildItem -LiteralPath $TargetDir -Force
  Compress-Archive -LiteralPath $Items.FullName -DestinationPath $ZipPath -Force
}

Write-Host "Current build : $BuildDir"
Write-Host "Dist copy     : $TargetDir"
if (-not $NoZip) {
  Write-Host "Dist zip      : $ZipPath"
}
Write-Host ""
Write-Host "Run copied build:"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\serve-local.ps1"
