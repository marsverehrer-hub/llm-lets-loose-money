# Builds a zip a friend can unzip and run with start.bat: no Node.js, no install. Run via `npm run package`.
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$out = Join-Path $root 'release'
$stage = Join-Path $out 'LLM-Lets-Loose-Money'
$zip = Join-Path $out 'LLM-Lets-Loose-Money.zip'

if (-not (Test-Path (Join-Path $root 'dist\index.html'))) { throw 'dist is missing: run vite build first.' }
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $stage 'scripts') | Out-Null

Copy-Item (Join-Path $root 'dist') (Join-Path $stage 'dist') -Recurse
Copy-Item (Join-Path $root 'start.bat') $stage
Copy-Item (Join-Path $root 'scripts\serve.ps1') (Join-Path $stage 'scripts')
@'
LLM: Lets Loose Money

1. Unzip this folder anywhere.
2. Double-click start.bat. The game opens in your browser (keep the black window open while playing).
3. Multiplayer: Menu > Multiplayer... One player hosts and sends the room code, the other picks Join and enters it.
   You connect peer to peer; both of you need an internet connection.
'@ | Set-Content -Encoding utf8 (Join-Path $stage 'README.txt')

if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $stage -DestinationPath $zip
Write-Host "Packaged: $zip"
