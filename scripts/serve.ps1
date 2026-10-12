# Tiny static web server for the built game (no Node needed). Used by start.bat.
# Serves -Root on http://localhost:<Port>/ and opens the browser. Close the window to stop.
param(
  [string]$Root = (Join-Path $PSScriptRoot '..\dist'),
  [int]$Port = 5380,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
if (-not (Test-Path (Join-Path $rootFull 'index.html'))) {
  Write-Host "Could not find the game files in $rootFull" -ForegroundColor Red
  exit 1
}

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'
  '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.gif' = 'image/gif'; '.webp' = 'image/webp'; '.ico' = 'image/x-icon'
  '.woff' = 'font/woff'; '.woff2' = 'font/woff2'; '.ttf' = 'font/ttf'; '.mp3' = 'audio/mpeg'; '.ogg' = 'audio/ogg'
  '.wav' = 'audio/wav'; '.txt' = 'text/plain; charset=utf-8'; '.map' = 'application/json'
}

# Saves live in the browser per address, so keep the same port when we can and only move on if it is taken.
$listener = $null
foreach ($p in $Port..($Port + 9)) {
  $l = New-Object System.Net.HttpListener
  $l.Prefixes.Add("http://localhost:$p/")
  try { $l.Start(); $listener = $l; $Port = $p; break } catch { $l.Close() }
}
if (-not $listener) {
  Write-Host "Ports $Port-$($Port + 9) are all in use. Close other copies of the game and try again." -ForegroundColor Red
  exit 1
}

$url = "http://localhost:$Port/"
Write-Host ''
Write-Host '  LLM: Lets Loose Money' -ForegroundColor Yellow
Write-Host "  Running at $url"
Write-Host '  Multiplayer: Menu > Multiplayer... One player hosts and shares the room code, the other joins.'
Write-Host '  Keep this window open while you play. Close it to quit.'
Write-Host ''
if (-not $NoBrowser) { Start-Process $url }

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/').Replace('/', '\')
    if ($rel -eq '') { $rel = 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $rootFull $rel))
    # Never serve anything outside the game folder; unknown paths fall back to the page itself.
    if (-not $file.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $file -PathType Leaf)) {
      $file = Join-Path $rootFull 'index.html'
    }
    $ext = [IO.Path]::GetExtension($file).ToLowerInvariant()
    $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
    $res.Headers.Add('Cache-Control', 'no-cache')
    $bytes = [IO.File]::ReadAllBytes($file)
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch {
    $res.StatusCode = 500
  } finally {
    $res.Close()
  }
}
