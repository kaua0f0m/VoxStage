param([switch]$UseBuiltLibraries)

$ErrorActionPreference = 'Stop'
$nativeRoot = Split-Path -Parent $PSScriptRoot
$tauriRoot = Join-Path $nativeRoot 'src-tauri'
$androidRoot = Join-Path $tauriRoot 'gen\android'
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr' }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
if (-not $env:NDK_HOME) { $env:NDK_HOME = Join-Path $env:ANDROID_HOME 'ndk\27.2.12479018' }

Push-Location $nativeRoot
try {
    if (-not $UseBuiltLibraries) {
        foreach ($target in @('aarch64', 'armv7')) {
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-android.ps1') -Target $target -Release
            if ($LASTEXITCODE -ne 0) { throw "A compilação de $target falhou." }
        }
    }
    & node (Join-Path $PSScriptRoot 'sync-frontend.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível preparar a interface.' }
    foreach ($entry in @(@{Triple='aarch64-linux-android';Abi='arm64-v8a'}, @{Triple='armv7-linux-androideabi';Abi='armeabi-v7a'})) {
        $source = Join-Path $tauriRoot "target\$($entry.Triple)\release\libvoxstage_native.so"
        if (-not (Test-Path -LiteralPath $source)) { throw "Biblioteca ausente: $source" }
        $destination = Join-Path $androidRoot "app\src\main\jniLibs\$($entry.Abi)"
        New-Item -ItemType Directory -Path $destination -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination (Join-Path $destination 'libvoxstage_native.so') -Force
    }
    Push-Location $androidRoot
    try {
        & .\gradlew.bat assembleUniversalRelease -x rustBuildUniversalRelease '-PabiList=arm64-v8a,armeabi-v7a' '-ParchList=arm64,arm' '-PtargetList=aarch64,armv7'
        if ($LASTEXITCODE -ne 0) { throw 'O APK universal não foi gerado.' }
    } finally { Pop-Location }
    $apk = Join-Path $androidRoot 'app\build\outputs\apk\universal\release\app-universal-release.apk'
    if (-not (Test-Path -LiteralPath $apk)) { throw "Não encontrei o APK: $apk" }
    $releaseDir = Join-Path (Split-Path -Parent $nativeRoot) 'releases\V1.0.1'
    New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
    Copy-Item -LiteralPath $apk -Destination (Join-Path $releaseDir 'VoxStage-1.0.1-Android-GoogleTV.apk') -Force
    Write-Host "Android / Google TV: $releaseDir\VoxStage-1.0.1-Android-GoogleTV.apk"
} finally { Pop-Location }
