param([switch]$DebugBuild)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$taskVersion = (Get-Content (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
$taskSuffix = if ($DebugBuild) { '-debug' } else { '' }
$taskPackage = Join-Path $taskRoot "releases/V$taskVersion$taskSuffix/VoxStage-Windows-x64"
$taskExecutable = Join-Path $taskPackage 'VoxStage.exe'
$taskPython = Join-Path $taskPackage 'app/python/python.exe'
$taskResults = Join-Path $taskRoot 'native-app/test-results'
$taskData = Join-Path $taskResults ('lifecycle-data-' + [guid]::NewGuid())
$taskProfile = Join-Path $taskResults ('lifecycle-profile-' + [guid]::NewGuid())
function Test-TaskPort([int]$Port) {
    $taskProbe = [Net.Sockets.TcpClient]::new()
    try { $taskProbe.Connect('127.0.0.1', $Port); return $taskProbe.Connected } catch { return $false } finally { $taskProbe.Dispose() }
}
foreach ($taskPort in @(8000, 9229)) { if (Test-TaskPort $taskPort) { throw "Test port $taskPort is already occupied." } }
New-Item -ItemType Directory -Path $taskData, $taskProfile -Force | Out-Null
Set-Content -LiteralPath (Join-Path $taskData 'library.json') -Value '[]' -Encoding utf8NoBOM
$taskNames = @('VOXSTAGE_DATA_DIR', 'WEBVIEW2_USER_DATA_FOLDER', 'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS')
$taskPrevious = @{}
foreach ($taskName in $taskNames) { $taskPrevious[$taskName] = [Environment]::GetEnvironmentVariable($taskName, 'Process') }
$env:VOXSTAGE_DATA_DIR = $taskData
$env:WEBVIEW2_USER_DATA_FOLDER = $taskProfile
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9229 --mute-audio'
$taskLaunches = @()
$taskApp = $null
$taskBackend = $null
try {
    foreach ($taskMode in @('graceful', 'forced')) {
        $taskApp = Start-Process -FilePath $taskExecutable -WorkingDirectory $taskPackage -WindowStyle Hidden -PassThru
        [void]$taskApp.Handle
        $taskReady = $false
        $taskDeadline = [DateTime]::UtcNow.AddSeconds(30)
        while ([DateTime]::UtcNow -lt $taskDeadline) {
            try {
                $taskPages = Invoke-RestMethod 'http://127.0.0.1:9229/json/list' -TimeoutSec 1
                $taskPage = $taskPages | Where-Object { $_.url -like 'http://127.0.0.1:8000/*' } | Select-Object -First 1
                if ($taskPage -and (Invoke-WebRequest 'http://127.0.0.1:8000/api/build-mode' -TimeoutSec 1).StatusCode -eq 200) { $taskReady = $true; break }
            } catch {}
            Start-Sleep -Milliseconds 200
        }
        if (-not $taskReady) { throw 'Native application did not become ready.' }
        if ($taskPage.url -notmatch '[?&]launch=([^&]+)') { throw 'Native entry URL has no cache bypass.' }
        $taskLaunches += $Matches[1]
        $taskChild = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($taskApp.Id)" | Where-Object { $_.ExecutablePath -eq $taskPython } | Select-Object -First 1
        if (-not $taskChild) { throw 'The application must own its packaged Python backend.' }
        $taskBackend = Get-Process -Id $taskChild.ProcessId
        [void]$taskBackend.Handle
        if ($taskMode -eq 'graceful') { [void]$taskApp.CloseMainWindow() } else { $taskApp.Kill() }
        if (-not $taskApp.WaitForExit(10000)) { throw "Application did not exit: $taskMode" }
        if (-not $taskBackend.WaitForExit(10000)) { throw "Backend survived its parent: $taskMode" }
        if (Test-TaskPort 8000) { throw "Server port remained occupied: $taskMode" }
        Write-Output "PASS native lifecycle: $taskMode closure stops the owned backend and releases port 8000."
    }
    if ($taskLaunches[0] -eq $taskLaunches[1]) { throw 'Repeated launches reused the same entry URL.' }
    Write-Output 'PASS native cache: reopening with the same profile requests a different entry URL.'
} finally {
    # These Process handles refer only to processes created and validated above.
    if ($taskApp -and -not $taskApp.HasExited) { $taskApp.Kill(); [void]$taskApp.WaitForExit(5000) }
    if ($taskBackend -and -not $taskBackend.HasExited) { $taskBackend.Kill(); [void]$taskBackend.WaitForExit(5000) }
    foreach ($taskName in $taskNames) { [Environment]::SetEnvironmentVariable($taskName, $taskPrevious[$taskName], 'Process') }
}
