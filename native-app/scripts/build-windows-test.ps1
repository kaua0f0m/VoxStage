$ErrorActionPreference = 'Stop'
$taskNativeRoot = Split-Path -Parent $PSScriptRoot
$taskVersion = '1.1.0'
$taskPreviousVersion = $env:VOXSTAGE_BUILD_VERSION
$taskPreviousFfmpeg = $env:VOXSTAGE_FFMPEG
$env:VOXSTAGE_BUILD_VERSION = $taskVersion
if (-not $env:VOXSTAGE_FFMPEG -and -not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    $taskProjectRoot = Split-Path -Parent $taskNativeRoot
    $taskStableVersion = (Get-Content (Join-Path $taskProjectRoot 'package.json') -Raw | ConvertFrom-Json).version
    $taskBundledFfmpeg = Join-Path $taskProjectRoot "releases/V$taskStableVersion/VoxStage-Windows-x64/app/bin/ffmpeg.exe"
    if (Test-Path -LiteralPath $taskBundledFfmpeg) { $env:VOXSTAGE_FFMPEG = $taskBundledFfmpeg }
}
$env:PATH = (Join-Path $env:USERPROFILE '.cargo\bin') + ';' + $env:PATH
Push-Location $taskNativeRoot
try {
    & node node_modules/@tauri-apps/cli/tauri.js build --no-bundle --config src-tauri/tauri.windows-test.conf.json
    if ($LASTEXITCODE -ne 0) { throw 'Windows test compilation failed.' }
    $env:VOXSTAGE_BUILD_VERSION = $taskVersion
    if ($env:PYTHON) { & $env:PYTHON (Join-Path $PSScriptRoot 'package-windows.py') --reuse-build-info }
    else { & py -3.13 (Join-Path $PSScriptRoot 'package-windows.py') --reuse-build-info }
    if ($LASTEXITCODE -ne 0) { throw 'Windows test packaging failed.' }
} finally {
    $env:VOXSTAGE_BUILD_VERSION = $taskPreviousVersion
    $env:VOXSTAGE_FFMPEG = $taskPreviousFfmpeg
    Pop-Location
}
