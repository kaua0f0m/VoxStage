$ErrorActionPreference = 'Stop'
$nativeRoot = Split-Path -Parent $PSScriptRoot
$env:PATH = (Join-Path $env:USERPROFILE '.cargo\bin') + ';' + $env:PATH
Push-Location $nativeRoot
try {
    & node node_modules/@tauri-apps/cli/tauri.js build --no-bundle --config src-tauri/tauri.desktop-release.conf.json
    if ($LASTEXITCODE -ne 0) { throw 'Windows compilation failed.' }
    if ($env:PYTHON) { & $env:PYTHON (Join-Path $PSScriptRoot 'package-windows.py') }
    else { & py -3.13 (Join-Path $PSScriptRoot 'package-windows.py') }
    if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed.' }
} finally { Pop-Location }
