param(
  [string]$OutputDir = (Join-Path $PSScriptRoot 'dist')
)

$ErrorActionPreference = 'Stop'

$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BundleName = "log-graph-review-source-$Stamp"
$BundleDir = Join-Path $OutputDir $BundleName
$ZipPath = Join-Path $OutputDir "$BundleName.zip"

if (Test-Path $BundleDir) { Remove-Item -LiteralPath $BundleDir -Recurse -Force }
New-Item -ItemType Directory -Path $BundleDir | Out-Null

$IncludePaths = @(
  '.github',
  'data_base\test_base.txt',
  'docs',
  'review',
  'src',
  'tests',
  'tools',
  'vendor',
  '.gitattributes',
  '.gitignore',
  'make-portable.ps1',
  'make-review-bundle.ps1',
  'package.json',
  'parser.worker.js',
  'README.md',
  'serve-local.ps1',
  'trace.worker.js'
)

foreach ($RelPath in $IncludePaths) {
  $Source = Join-Path $PSScriptRoot $RelPath
  if (-not (Test-Path $Source)) { continue }

  $Target = Join-Path $BundleDir $RelPath
  $TargetParent = Split-Path -Parent $Target
  if ($TargetParent -and -not (Test-Path $TargetParent)) {
    New-Item -ItemType Directory -Path $TargetParent -Force | Out-Null
  }

  Copy-Item -LiteralPath $Source -Destination $Target -Recurse -Force
}

if (Test-Path $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
$Items = Get-ChildItem -LiteralPath $BundleDir -Force
Compress-Archive -LiteralPath $Items.FullName -DestinationPath $ZipPath -Force

Write-Host "Review source folder: $BundleDir"
Write-Host "Review source zip   : $ZipPath"
Write-Host ""
Write-Host "This bundle intentionally excludes dist, .git, node_modules, generated root HTML, and production logs."
