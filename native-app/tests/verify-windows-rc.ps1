$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$taskVersion = (Get-Content (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
$taskExecutable = Join-Path $taskRoot "releases/V$taskVersion/VoxStage-Windows-x64/VoxStage.exe"
$taskResults = Join-Path $taskRoot 'native-app/test-results'
$taskData = Join-Path $taskResults ('rc-native-data-' + [guid]::NewGuid())
$taskProfile = Join-Path $taskResults ('rc-native-profile-' + [guid]::NewGuid())
foreach ($taskPath in @($taskData, $taskProfile)) {
    if (-not ([IO.Path]::GetFullPath($taskPath)).StartsWith([IO.Path]::GetFullPath($taskResults) + [IO.Path]::DirectorySeparatorChar)) { throw 'Test path outside workspace.' }
}
$taskProbe = [Net.Sockets.TcpClient]::new()
try { $taskProbe.Connect('127.0.0.1', 8000) } catch {}
if ($taskProbe.Connected) { $taskProbe.Dispose(); throw 'Close the existing VoxStage before the isolated native test.' }
$taskProbe.Dispose()
New-Item -ItemType Directory -Path $taskData, $taskProfile -Force | Out-Null
Set-Content -LiteralPath (Join-Path $taskData 'library.json') -Value '[]' -Encoding utf8NoBOM
$taskNames = @('VOXSTAGE_DATA_DIR', 'WEBVIEW2_USER_DATA_FOLDER', 'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', 'NODE_PATH')
$taskPrevious = @{}
foreach ($taskName in $taskNames) { $taskPrevious[$taskName] = [Environment]::GetEnvironmentVariable($taskName, 'Process') }
$env:VOXSTAGE_DATA_DIR = $taskData
$env:WEBVIEW2_USER_DATA_FOLDER = $taskProfile
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9229 --mute-audio --use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=' + (Join-Path $taskResults 'score-mic-tone.wav')
$env:NODE_PATH = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'
$taskProcess = $null
try {
    $taskProcess = Start-Process -FilePath $taskExecutable -WorkingDirectory (Split-Path -Parent $taskExecutable) -WindowStyle Hidden -PassThru
    & node (Join-Path $PSScriptRoot 'scoring-native.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Native RC scoring verification failed.' }
    $taskProcess.Refresh()
    if ($taskProcess.MainWindowTitle -ne "VoxStage $taskVersion") { throw "Unexpected native window title: $($taskProcess.MainWindowTitle)" }
} finally {
    foreach ($taskName in $taskNames) { [Environment]::SetEnvironmentVariable($taskName, $taskPrevious[$taskName], 'Process') }
    if ($taskProcess -and -not $taskProcess.HasExited) {
        # Only the application created by this test, with graceful backend cleanup.
        [void]$taskProcess.CloseMainWindow()
        if (-not $taskProcess.WaitForExit(5000)) {
            $taskChildren = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($taskProcess.Id)"
            foreach ($taskChild in $taskChildren) {
                if ($taskChild.ExecutablePath -and ([IO.Path]::GetFullPath($taskChild.ExecutablePath)).StartsWith((Split-Path -Parent $taskExecutable) + [IO.Path]::DirectorySeparatorChar)) {
                    Stop-Process -Id $taskChild.ProcessId -ErrorAction SilentlyContinue
                }
            }
            Stop-Process -Id $taskProcess.Id -ErrorAction SilentlyContinue
        }
    }
}
