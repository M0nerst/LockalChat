$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$env:Path = "$env:USERPROFILE\.cargo\bin;" + $env:Path
Push-Location $root
cargo build -p lockal-daemon --release
Pop-Location
$binDir = Join-Path $PSScriptRoot "..\src-tauri\bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
Copy-Item (Join-Path $root "target\release\lockal-daemon.exe") (Join-Path $binDir "lockal-daemon-x86_64-pc-windows-msvc.exe") -Force
Write-Host "Sidecar copied to src-tauri/bin"
