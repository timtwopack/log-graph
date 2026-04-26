param(
  [int]$Port = 8765,
  [string]$Root = '',
  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Root)) {
  $BuiltRoot = Join-Path $PSScriptRoot 'dist\server'
  if (Test-Path (Join-Path $BuiltRoot 'index.html')) {
    $Root = $BuiltRoot
  } else {
    $Root = $PSScriptRoot
  }
}

$RootFull = [System.IO.Path]::GetFullPath($Root)
$RootNorm = $RootFull.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

function Get-MimeType {
  param([string]$Path)
  switch -Regex ($Path.ToLowerInvariant()) {
    '\.html$' { return 'text/html; charset=utf-8' }
    '\.js$'   { return 'text/javascript; charset=utf-8' }
    '\.css$'  { return 'text/css; charset=utf-8' }
    '\.json$' { return 'application/json; charset=utf-8' }
    '\.md$'   { return 'text/markdown; charset=utf-8' }
    '\.txt$'  { return 'text/plain; charset=utf-8' }
    '\.csv$'  { return 'text/csv; charset=utf-8' }
    '\.png$'  { return 'image/png' }
    '\.jpg$'  { return 'image/jpeg' }
    '\.jpeg$' { return 'image/jpeg' }
    '\.svg$'  { return 'image/svg+xml' }
    '\.gz$'   { return 'application/gzip' }
    default   { return 'application/octet-stream' }
  }
}

function Write-HttpResponse {
  param(
    [System.IO.Stream]$Stream,
    [int]$Status,
    [string]$Reason,
    [byte[]]$Body,
    [string]$ContentType = 'text/plain; charset=utf-8',
    [switch]$HeadOnly
  )

  if ($null -eq $Body) { $Body = [byte[]]::new(0) }
  $Header =
    "HTTP/1.1 $Status $Reason`r`n" +
    "Content-Type: $ContentType`r`n" +
    "Content-Length: $($Body.Length)`r`n" +
    "Cache-Control: no-store`r`n" +
    "X-Content-Type-Options: nosniff`r`n" +
    "Content-Security-Policy: default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`r`n" +
    "Referrer-Policy: no-referrer`r`n" +
    "Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`r`n" +
    "Cross-Origin-Opener-Policy: same-origin`r`n" +
    "Cross-Origin-Resource-Policy: same-origin`r`n" +
    "Connection: close`r`n`r`n"

  $HeaderBytes = [System.Text.Encoding]::ASCII.GetBytes($Header)
  $Stream.Write($HeaderBytes, 0, $HeaderBytes.Length)
  if (-not $HeadOnly -and $Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
}

function Resolve-RequestPath {
  param([string]$Target)

  $PathPart = ($Target -split '\?', 2)[0]
  if ([string]::IsNullOrWhiteSpace($PathPart) -or $PathPart -eq '/') {
    $PathPart = '/index.html'
  }

  $Decoded = [System.Uri]::UnescapeDataString($PathPart)
  $Relative = $Decoded.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
  $Full = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($RootFull, $Relative))

  if ($Full -ne $RootFull -and -not $Full.StartsWith($RootNorm, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw [System.UnauthorizedAccessException]::new('Path escapes server root')
  }
  return $Full
}

$Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$Listener.Start()

$Url = "http://127.0.0.1:$Port/index.html"
Write-Host "PA-GRAPH local server"
Write-Host "Root: $RootFull"
Write-Host "URL : $Url"
Write-Host "Stop: Ctrl+C"

if (-not $NoOpen) {
  try { Start-Process $Url } catch { Write-Host "Open manually: $Url" }
}

try {
  while ($true) {
    $Client = $Listener.AcceptTcpClient()
    try {
      $Stream = $Client.GetStream()
      $Reader = [System.IO.StreamReader]::new($Stream, [System.Text.Encoding]::UTF8, $false, 4096, $true)
      $RequestLine = $Reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($RequestLine)) { continue }

      while ($true) {
        $Line = $Reader.ReadLine()
        if ($null -eq $Line -or $Line -eq '') { break }
      }

      if ($RequestLine -notmatch '^(GET|HEAD)\s+(\S+)\s+HTTP/') {
        $Body = [System.Text.Encoding]::UTF8.GetBytes('Method not allowed')
        Write-HttpResponse -Stream $Stream -Status 405 -Reason 'Method Not Allowed' -Body $Body
        continue
      }

      $Method = $Matches[1]
      $Target = $Matches[2]
      $HeadOnly = $Method -eq 'HEAD'

      try {
        $FilePath = Resolve-RequestPath -Target $Target
      } catch {
        $Body = [System.Text.Encoding]::UTF8.GetBytes('Forbidden')
        Write-HttpResponse -Stream $Stream -Status 403 -Reason 'Forbidden' -Body $Body -HeadOnly:$HeadOnly
        continue
      }

      if (-not [System.IO.File]::Exists($FilePath)) {
        $Body = [System.Text.Encoding]::UTF8.GetBytes('Not found')
        Write-HttpResponse -Stream $Stream -Status 404 -Reason 'Not Found' -Body $Body -HeadOnly:$HeadOnly
        continue
      }

      $Bytes = [System.IO.File]::ReadAllBytes($FilePath)
      Write-HttpResponse -Stream $Stream -Status 200 -Reason 'OK' -Body $Bytes -ContentType (Get-MimeType $FilePath) -HeadOnly:$HeadOnly
    } catch {
      try {
        $Body = [System.Text.Encoding]::UTF8.GetBytes("Server error: $($_.Exception.Message)")
        Write-HttpResponse -Stream $Stream -Status 500 -Reason 'Internal Server Error' -Body $Body
      } catch {}
    } finally {
      $Client.Close()
    }
  }
} finally {
  $Listener.Stop()
}
