param(
    [ValidateSet('aarch64', 'armv7', 'i686', 'x86_64')]
    [string]$Target = 'aarch64',
    [switch]$Release,
    [switch]$StandaloneDebug
)

$ErrorActionPreference = 'Stop'
$nativeRoot = Split-Path -Parent $PSScriptRoot
$tauriRoot = Join-Path $nativeRoot 'src-tauri'
$androidRoot = Join-Path $tauriRoot 'gen\android'
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr' }
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
if (-not $env:NDK_HOME) { $env:NDK_HOME = Join-Path $sdkRoot 'ndk\27.2.12479018' }
$env:PATH = (Join-Path $env:USERPROFILE '.cargo\bin') + ';' + $env:PATH

$targetDetails = @{
    aarch64 = @{ Abi = 'arm64-v8a'; Gradle = 'Arm64' }
    armv7   = @{ Abi = 'armeabi-v7a'; Gradle = 'Arm' }
    i686    = @{ Abi = 'x86'; Gradle = 'X86' }
    x86_64  = @{ Abi = 'x86_64'; Gradle = 'X86_64' }
}[$Target]
$profile = if ($Release) { 'release' } else { 'debug' }
$gradleProfile = if ($Release) { 'Release' } else { 'Debug' }
$profileFlag = if ($Release) { @() } else { @('--debug') }
$configFlag = if ($StandaloneDebug) {
    if ($Release) { throw '-StandaloneDebug só pode ser usado com o build debug.' }
    @('--config', (Join-Path $tauriRoot 'tauri.android.standalone-debug.conf.json'))
} else { @() }
$apkDir = Join-Path $androidRoot "app\build\outputs\apk\$($targetDetails.Gradle.ToLowerInvariant())\$($profile.ToLowerInvariant())"

function Get-BuiltApk {
    if (-not (Test-Path $apkDir)) { return $null }
    Get-ChildItem -LiteralPath $apkDir -Filter '*.apk' -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}

if (-not (Test-Path (Join-Path $androidRoot 'gradlew.bat'))) {
    throw 'O projeto Android ainda não foi inicializado. Execute tauri android init primeiro.'
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$tauriCli = Join-Path $nativeRoot 'node_modules\@tauri-apps\cli\tauri.js'
& $node (Join-Path $PSScriptRoot 'prepare-android.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Android preparation failed.' }
Set-Location $nativeRoot
$buildArgs = @($tauriCli, 'android', 'build', '--target', $Target, '--apk') + $profileFlag + $configFlag
$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    $buildLog = Join-Path $nativeRoot "android-build-$Target-$profile.log"
    $cliOutput = & $node @buildArgs 2>&1 | Tee-Object -FilePath $buildLog
    $cliExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorAction
}
$cliOutput | ForEach-Object { Write-Host $_ }

if ($cliExit -eq 0) {
    $apk = Get-BuiltApk
    if (-not $apk) { throw "Tauri terminou, mas não encontrei o APK em $apkDir" }
    Write-Host "APK gerado em: $($apk.FullName)"
    exit 0
}

$cliText = $cliOutput -join "`n"
if ($cliText -notmatch 'symbolic link|symlink') {
    $cliOutput | ForEach-Object { Write-Host $_ }
    throw "A compilação Tauri falhou por outro motivo (código $cliExit)."
}
Write-Host 'Windows bloqueou o symlink do Tauri; vou copiar a biblioteca e continuar com Gradle.'

# Windows without Developer Mode cannot create Tauri's Android library symlink.
# Cargo has already built the library; copy it and let Gradle package just this ABI.
$targetTriple = switch ($Target) {
    'aarch64' { 'aarch64-linux-android' }
    'armv7'   { 'armv7-linux-androideabi' }
    'i686'    { 'i686-linux-android' }
    'x86_64'  { 'x86_64-linux-android' }
}
$library = Join-Path $tauriRoot "target\$targetTriple\$profile\libvoxstage_native.so"
if (-not (Test-Path $library)) {
    throw "A biblioteca Android não foi gerada: $library"
}
$jniDir = Join-Path $androidRoot "app\src\main\jniLibs\$($targetDetails.Abi)"
New-Item -ItemType Directory -Path $jniDir -Force | Out-Null
Copy-Item -LiteralPath $library -Destination (Join-Path $jniDir 'libvoxstage_native.so') -Force

$gradleTask = "assemble$($targetDetails.Gradle)$gradleProfile"
$skipRustTask = "rustBuild$($targetDetails.Gradle)$gradleProfile"
$gradle = Join-Path $androidRoot 'gradlew.bat'
$ErrorActionPreference = 'Continue'
Push-Location $androidRoot
try {
    & $gradle $gradleTask '-x' $skipRustTask
    $gradleExit = $LASTEXITCODE
} finally {
    Pop-Location
    $ErrorActionPreference = $previousErrorAction
}
if ($gradleExit -ne 0) { throw "Gradle falhou ao criar o APK (código $gradleExit)." }
$apk = Get-BuiltApk
if (-not $apk) { throw "Gradle terminou, mas não encontrei o APK em $apkDir" }

Write-Host "APK gerado em: $($apk.FullName)"
