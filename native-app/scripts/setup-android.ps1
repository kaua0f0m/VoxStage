$ErrorActionPreference = 'Stop'

$androidSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$androidStudioJbr = 'C:\Program Files\Android\Android Studio\jbr'
$commandLineToolsZip = Join-Path $env:TEMP 'voxstage-commandlinetools-win.zip'
$commandLineToolsUrl = 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip'
$expectedSha256 = '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'

if (-not (Test-Path (Join-Path $androidSdk 'cmdline-tools\latest\bin\sdkmanager.bat'))) {
    # curl can resume a partial archive if Windows shuts down before this finishes.
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
        & $curl.Source --fail --location --retry 5 --retry-delay 2 --continue-at - --output $commandLineToolsZip $commandLineToolsUrl
        if ($LASTEXITCODE -ne 0) { throw 'Não foi possível baixar as ferramentas Android.' }
    } else {
        Invoke-WebRequest -Uri $commandLineToolsUrl -OutFile $commandLineToolsZip
    }
    $actualSha256 = (Get-FileHash -LiteralPath $commandLineToolsZip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha256 -ne $expectedSha256) { throw "Checksum inválido para as ferramentas Android: $actualSha256" }

    $staging = Join-Path $env:TEMP 'voxstage-commandlinetools-staging'
    Expand-Archive -LiteralPath $commandLineToolsZip -DestinationPath $staging -Force
    $latest = Join-Path $androidSdk 'cmdline-tools\latest'
    New-Item -ItemType Directory -Path $latest -Force | Out-Null
    Copy-Item -Path (Join-Path $staging 'cmdline-tools\*') -Destination $latest -Recurse -Force
}

$env:JAVA_HOME = $androidStudioJbr
$env:ANDROID_HOME = $androidSdk
$env:ANDROID_SDK_ROOT = $androidSdk
$sdkManager = Join-Path $androidSdk 'cmdline-tools\latest\bin\sdkmanager.bat'
$answers = (1..100 | ForEach-Object { 'y' })
$answers | & $sdkManager "--sdk_root=$androidSdk" --licenses | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível aceitar/configurar as licenças do SDK Android.' }

$answers | & $sdkManager "--sdk_root=$androidSdk" 'platform-tools' 'platforms;android-36' 'platforms;android-37' 'build-tools;36.0.0' 'ndk;27.2.12479018'
if ($LASTEXITCODE -ne 0) { throw 'A instalação do Android SDK/NDK falhou.' }

$ndkHome = Join-Path $androidSdk 'ndk\27.2.12479018'
[Environment]::SetEnvironmentVariable('JAVA_HOME', $androidStudioJbr, 'User')
[Environment]::SetEnvironmentVariable('ANDROID_HOME', $androidSdk, 'User')
[Environment]::SetEnvironmentVariable('ANDROID_SDK_ROOT', $androidSdk, 'User')
[Environment]::SetEnvironmentVariable('NDK_HOME', $ndkHome, 'User')

Write-Host "Android SDK pronto em $androidSdk"
