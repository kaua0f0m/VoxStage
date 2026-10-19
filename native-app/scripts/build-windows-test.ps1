$ErrorActionPreference = 'Stop'
$taskNativeRoot = Split-Path -Parent $PSScriptRoot
$taskProjectRoot = Split-Path -Parent $taskNativeRoot
$taskVersion = (Get-Content (Join-Path $taskProjectRoot 'package.json') -Raw | ConvertFrom-Json).version
$taskPreviousVersion = $env:VOXSTAGE_BUILD_VERSION
$taskPreviousFfmpeg = $env:VOXSTAGE_FFMPEG
$env:VOXSTAGE_BUILD_VERSION = $taskVersion
if (-not $env:VOXSTAGE_FFMPEG -and -not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    $taskStableVersion = (Get-Content (Join-Path $taskProjectRoot 'package.json') -Raw | ConvertFrom-Json).version
    $taskBundledFfmpeg = Join-Path $taskProjectRoot "releases/V$taskStableVersion/VoxStage-Windows-x64/app/bin/ffmpeg.exe"
    if (Test-Path -LiteralPath $taskBundledFfmpeg) { $env:VOXSTAGE_FFMPEG = $taskBundledFfmpeg }
    else {
        $taskRuntimeCandidates = Get-ChildItem -LiteralPath (Join-Path $taskProjectRoot 'releases') -Directory | Sort-Object Name -Descending
        foreach ($taskRuntimeCandidate in $taskRuntimeCandidates) {
            $taskCandidateFfmpeg = Join-Path $taskRuntimeCandidate.FullName 'VoxStage-Windows-x64/app/bin/ffmpeg.exe'
            if (Test-Path -LiteralPath $taskCandidateFfmpeg) { $env:VOXSTAGE_FFMPEG = $taskCandidateFfmpeg; break }
        }
    }
}
$env:PATH = (Join-Path $env:USERPROFILE '.cargo\bin') + ';' + $env:PATH
Push-Location $taskNativeRoot
try {
    & node node_modules/@tauri-apps/cli/tauri.js build --debug --features desktop-standalone --no-bundle --config src-tauri/tauri.windows-test.conf.json
    if ($LASTEXITCODE -ne 0) { throw 'Windows test compilation failed.' }
    $env:VOXSTAGE_BUILD_VERSION = $taskVersion
    if ($env:PYTHON) { & $env:PYTHON (Join-Path $PSScriptRoot 'package-windows.py') --debug --reuse-build-info }
    else { & py -3.13 (Join-Path $PSScriptRoot 'package-windows.py') --debug --reuse-build-info }
    if ($LASTEXITCODE -ne 0) { throw 'Windows test packaging failed.' }
} finally {
    $env:VOXSTAGE_BUILD_VERSION = $taskPreviousVersion
    $env:VOXSTAGE_FFMPEG = $taskPreviousFfmpeg
    Pop-Location
}
