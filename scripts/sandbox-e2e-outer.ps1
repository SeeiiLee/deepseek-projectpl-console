param(
  [Parameter(Mandatory = $true)][string]$InputDir,
  [Parameter(Mandatory = $true)][string]$EvidenceDir,
  [Parameter(Mandatory = $true)][string]$RunId,
  [int]$ServerPort = 8765,
  [string]$Scenario = 'positive'
)

$ErrorActionPreference = 'Stop'
$serverProc = $null
$baselineFree = (Get-PSDrive C).Free

function Assert-DiskHeadroom {
  $currentFree = (Get-PSDrive C).Free
  $usedBytes = $baselineFree - $currentFree
  if ($usedBytes -gt 5GB) {
    throw "C drive usage exceeded 5 GiB: $([math]::Round($usedBytes / 1GB, 2)) GiB; stopping instead of deleting system Containers data."
  }
}

function Write-CurrentVersion {
  param([string]$Version)
  Set-Content -LiteralPath (Join-Path $EvidenceDir 'current.txt') -Value $Version -Encoding Ascii
  Write-Output "CURRENT $Version"
}

function Write-ArtifactSet {
  $artifacts = @()
  foreach ($version in @('0.4.0', '0.4.1', '0.4.2')) {
    $installerName = "DeepSeek-Harness-Personal-Dev-$version-setup-x64.exe"
    $installerPath = Join-Path $InputDir "packages\$version\$installerName"
    if (-not (Test-Path -LiteralPath $installerPath)) { throw "Artifact installer missing: $installerPath" }
    $receiptPath = Join-Path $InputDir "packages\$version\build-receipt.json"
    if (-not (Test-Path -LiteralPath $receiptPath)) { throw "Artifact build receipt missing: $receiptPath" }
    $sha = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLower()
    $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    $role = if ($version -eq '0.4.0') { 'C' } elseif ($version -eq '0.4.1') { 'A' } else { 'B' }
    $artifacts += [ordered]@{
      role = $role
      version = $version
      fileName = $installerName
      relativePath = "packages\$version\$installerName"
      absolutePath = $installerPath
      sha256 = $sha
      buildReceiptTreeHash = $receipt.packagedTreeHash
    }
  }
  $artifactSet = [ordered]@{
    schemaVersion = 1
    runId = $RunId
    generatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    artifacts = $artifacts
  } | ConvertTo-Json -Depth 5
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $artifactSetPath = Join-Path $EvidenceDir 'artifact-set.json'
  [System.IO.File]::WriteAllText($artifactSetPath, $artifactSet, $utf8NoBom)
  Write-Output "ARTIFACT_SET $artifactSetPath"
}

function Assert-FinalUpdateCenter {
  param([string]$StatePath)
  if (-not (Test-Path -LiteralPath $StatePath)) { throw "Final update-center.json missing: $StatePath" }
  $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
  $errors = @()
  $results = [ordered]@{}
  if ($null -eq $state.knownGoodDesktop) {
    $errors += 'knownGoodDesktop is missing'
  } else {
    $results['knownGoodDesktop.version'] = [string]$state.knownGoodDesktop.version
    if ($state.knownGoodDesktop.version -ne '0.4.1') {
      $errors += "knownGoodDesktop.version expected 0.4.1 but got $($state.knownGoodDesktop.version)"
    }
  }
  foreach ($field in @('downloadedDesktop', 'previousDesktop', 'installPending', 'rollbackPending')) {
    $prop = $state.PSObject.Properties[$field]
    $present = $null -ne $prop
    $results[$field] = if ($present) { 'present' } else { 'absent' }
    if ($present) { $errors += "$field must be absent but is present" }
  }
  if ($errors.Count -gt 0) {
    $summary = $errors -join '; '
    Write-Output "FINAL_UPDATE_CENTER_FAIL $summary"
    throw "Final update-center assertion failed: $summary"
  }
  $assertionResult = [ordered]@{
    schemaVersion = 1
    runId = $RunId
    passed = $true
    knownGoodDesktopVersion = $results['knownGoodDesktop.version']
    downloadedDesktopAbsent = $true
    previousDesktopAbsent = $true
    installPendingAbsent = $true
    rollbackPendingAbsent = $true
  } | ConvertTo-Json -Depth 4
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Join-Path $EvidenceDir 'final-update-center-assertions.json'), $assertionResult, $utf8NoBom)
  Write-Output "FINAL_UPDATE_CENTER_OK knownGoodDesktop.version=$($results['knownGoodDesktop.version']) downloadedDesktop=absent previousDesktop=absent installPending=absent rollbackPending=absent"
}

function Start-LocalUpdateServer {
  $serverScript = Join-Path $InputDir 'sandbox-local-update-server.ps1'
  if (-not (Test-Path $serverScript)) { throw "Missing server script in input: $serverScript" }
  $packagesDir = Join-Path $InputDir 'packages'
  $currentFile = Join-Path $EvidenceDir 'current.txt'
  if (-not (Test-Path $packagesDir)) { throw "Missing packages dir: $packagesDir" }
  Set-Content -LiteralPath $currentFile -Value '0.4.0' -Encoding Ascii
  $args = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $serverScript,
    '-PackagesDir', $packagesDir,
    '-CurrentFile', $currentFile,
    '-RequiredVersions', '0.4.0,0.4.1,0.4.2',
    '-Port', $ServerPort
  )
  $serverProc = Start-Process -FilePath 'powershell.exe' -ArgumentList $args -PassThru -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 250
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$ServerPort/repos/cyrus/personal/releases/latest" -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { Write-Output 'SERVER_READY'; return }
    } catch {}
  } while ((Get-Date) -lt $deadline)
  throw 'Local update server did not become ready in time.'
}

function Stop-LocalUpdateServer {
  if ($null -ne $serverProc -and -not $serverProc.HasExited) {
    Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
  }
}

function Find-DevExe {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness Personal Dev\DeepSeek Harness Personal Dev.exe'),
    (Join-Path $env:LOCALAPPDATA 'DeepSeek Harness Personal Dev\DeepSeek Harness Personal Dev.exe'),
    (Join-Path $env:ProgramFiles 'DeepSeek Harness Personal Dev\DeepSeek Harness Personal Dev.exe')
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  $found = Get-ChildItem -Path $env:LOCALAPPDATA, $env:ProgramFiles -Filter 'DeepSeek Harness Personal Dev.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $found) { return $found.FullName }
  throw 'Installed Dev executable not found.'
}

function Invoke-Installer {
  param([string]$Version)
  $installer = Join-Path $InputDir "packages\$Version\DeepSeek-Harness-Personal-Dev-$Version-setup-x64.exe"
  if (-not (Test-Path -LiteralPath $installer)) { throw "Installer missing: $installer" }
  Write-Output "INSTALL $Version"
  $process = Start-Process -FilePath $installer -ArgumentList '/S' -PassThru -Wait
  if ($process.ExitCode -ne 0) { throw "Installer for $Version exited with code $($process.ExitCode)" }
  Assert-DiskHeadroom
}

function Write-E2EConfig {
  param([string]$Phase, [string]$JournalPath, [string]$EvidenceDirOverride = '')
  $effectiveEvidenceDir = if ($EvidenceDirOverride) { $EvidenceDirOverride } else { $EvidenceDir }
  $config = @{
    schemaVersion = 1
    runId = $RunId
    phase = $Phase
    localUpdateBase = "http://127.0.0.1:$ServerPort"
    evidenceDir = $effectiveEvidenceDir
    journalPath = $JournalPath
  } | ConvertTo-Json -Depth 4
  $configPath = Join-Path $EvidenceDir "config-$Phase-$([System.IO.Path]::GetFileNameWithoutExtension($JournalPath)).json"
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($configPath, $config, $utf8NoBom)
  return $configPath
}

function Get-LocalJournalPath {
  param([string]$EvidenceJournalPath)
  $journalDir = Join-Path $localRoot 'evidence'
  New-Item -ItemType Directory -Path $journalDir -Force | Out-Null
  return Join-Path $journalDir ([System.IO.Path]::GetFileName($EvidenceJournalPath))
}

function Copy-LocalJournalsToEvidence {
  $journalDir = Join-Path $localRoot 'evidence'
  if (-not (Test-Path -LiteralPath $journalDir)) { return }
  Get-ChildItem -LiteralPath $journalDir -File -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $EvidenceDir $_.Name) -Force
  }
}

function Start-App {
  param(
    [string]$Exe,
    [string]$Phase,
    [string]$JournalPath,
    [string]$UserData,
    [string]$DshHome
  )
  $localJournalPath = Get-LocalJournalPath $JournalPath
  $localEvidenceDir = Join-Path $localRoot 'evidence'
  New-Item -ItemType Directory -Path $localEvidenceDir -Force | Out-Null
  $configPath = Write-E2EConfig -Phase $Phase -JournalPath $localJournalPath -EvidenceDirOverride $localEvidenceDir
  New-Item -ItemType Directory -Path $UserData -Force | Out-Null
  New-Item -ItemType Directory -Path $DshHome -Force | Out-Null
  $env:DSH_DESKTOP_E2E_DRIVER = '1'
  $env:DSH_DESKTOP_E2E_CONFIG = $configPath
  $env:DSH_DESKTOP_E2E_LOCAL_UPDATE = '1'
  $env:DSH_DESKTOP_E2E_UPDATE_BASE_URL = "http://127.0.0.1:$ServerPort"
  $env:DSH_DESKTOP_USER_DATA = $UserData
  $env:DSH_HOME = $DshHome
  $env:DSH_SOURCE_ROOT = Join-Path $InputDir 'harness'
  $env:DSH_DESKTOP_STARTUP_TIMEOUT_MS = '180000'
  $sandboxNode = Join-Path $InputDir 'node\node.exe'
  if (Test-Path -LiteralPath $sandboxNode) {
    $env:DSH_NODE_EXECUTABLE = $sandboxNode
  }
  $env:DSH_MEMORY_SELF_TEST = '1'
  $env:DSH_MEMORY_EXTRACTION = ''
  $env:DSH_MEMORY_QUICKPASS = ''
  Write-Host "START_PHASE $Phase"
  $stdoutPath = Join-Path $EvidenceDir "app-$Phase-$([System.IO.Path]::GetFileNameWithoutExtension($JournalPath)).stdout.log"
  $stderrPath = Join-Path $EvidenceDir "app-$Phase-$([System.IO.Path]::GetFileNameWithoutExtension($JournalPath)).stderr.log"
  $process = Start-Process -FilePath $Exe -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  Remove-Item Env:DSH_DESKTOP_E2E_DRIVER -ErrorAction SilentlyContinue
  Remove-Item Env:DSH_DESKTOP_E2E_CONFIG -ErrorAction SilentlyContinue
  Remove-Item Env:DSH_DESKTOP_E2E_LOCAL_UPDATE -ErrorAction SilentlyContinue
  Remove-Item Env:DSH_DESKTOP_E2E_UPDATE_BASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:DSH_DESKTOP_USER_DATA -ErrorAction SilentlyContinue
  Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue
  Remove-Item Env:DSH_SOURCE_ROOT -ErrorAction SilentlyContinue
  Remove-Item Env:DSH_NODE_EXECUTABLE -ErrorAction SilentlyContinue
  Remove-Item Env:DSH_DESKTOP_E2E_INSTALLER_FAIL -ErrorAction SilentlyContinue
  Remove-Item Env:DSH_DESKTOP_STARTUP_TIMEOUT_MS -ErrorAction SilentlyContinue
  return $process
}

function Wait-AppExit {
  param($Process, [int]$TimeoutSeconds = 240)
  if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    throw "App did not exit within $TimeoutSeconds seconds."
  }
  Assert-DiskHeadroom
  Copy-LocalJournalsToEvidence
}

function Wait-JournalStage {
  param([string]$JournalPath, [string]$Stage, [int]$TimeoutSeconds = 240)
  $localJournalPath = Get-LocalJournalPath $JournalPath
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (Test-Path -LiteralPath $localJournalPath) {
      try {
        $raw = [System.IO.File]::ReadAllText($localJournalPath, [System.Text.UTF8Encoding]::new($false))
        $journal = $raw | ConvertFrom-Json
        if ($journal.entries | Where-Object { $_.stage -eq $Stage }) {
          Write-Output "JOURNAL_STAGE $Stage"
          Copy-Item -LiteralPath $localJournalPath -Destination $JournalPath -Force
          return
        }
      } catch {}
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for journal stage $Stage in $JournalPath"
}

function Wait-RealWindow {
  param($Process, [int]$TimeoutSeconds = 60, [string]$Phase = '')
  if ($null -eq $Process) { throw 'Wait-RealWindow requires a process object.' }
  # The boot shell window is shown first. After the real Harness window is shown,
  # the shell is closed, so the process main window handle must change.
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline) {
    $Process.Refresh()
    if ($Process.MainWindowHandle -ne 0) { break }
    Start-Sleep -Milliseconds 250
  }
  $initialHandle = $Process.MainWindowHandle
  if ($initialHandle -eq 0) {
    throw 'Real window verification failed: no initial shell window handle observed.'
  }
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 250
    $Process.Refresh()
    $current = $Process.MainWindowHandle
    if ($current -ne 0 -and $current -ne $initialHandle) {
      Write-Output "REAL_WINDOW_SHOWN $current (was $initialHandle)"
      $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
      $verification = [ordered]@{
        schemaVersion = 1
        runId = $RunId
        phase = $Phase
        initialWindowHandle = $initialHandle
        finalWindowHandle = $current
        verifiedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        passed = $true
      } | ConvertTo-Json -Depth 4
      $verificationPath = Join-Path $EvidenceDir "real-window-verification-$Phase.json"
      [System.IO.File]::WriteAllText($verificationPath, $verification, $utf8NoBom)
      Write-Output "REAL_WINDOW_EVIDENCE $verificationPath"
      return
    }
  } while ((Get-Date) -lt $deadline)
  throw "Real window was not shown within $TimeoutSeconds seconds; last main window handle=$($Process.MainWindowHandle)"
}

function Stop-AppTree {
  param($Process)
  if ($null -ne $Process -and -not $Process.HasExited) {
    taskkill.exe /pid $Process.Id /t /f | Out-Null
  }
}

function Stop-Installer {
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'DeepSeek-Harness-Personal-Dev-*setup*' } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

function Wait-InstallerDone {
  param([int]$TimeoutSeconds = 240)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $seenInstaller = $false
  $appearDeadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline) {
    $installers = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'DeepSeek-Harness-Personal-Dev-*setup*' }
    if ($installers) {
      $seenInstaller = $true
      break
    }
    if ((Get-Date) -gt $appearDeadline) {
      Write-Output 'INSTALLER_DONE'
      return
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $seenInstaller) {
    Write-Output 'INSTALLER_DONE'
    return
  }
  while ((Get-Date) -lt $deadline) {
    $installers = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'DeepSeek-Harness-Personal-Dev-*setup*' }
    if (-not $installers) {
      Write-Output 'INSTALLER_DONE'
      return
    }
    Start-Sleep -Seconds 1
  }
  throw 'Installer did not finish in time.'
}

try {
  New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
  $localRoot = Join-Path $env:LOCALAPPDATA 'DSH_E2E'
  New-Item -ItemType Directory -Path $localRoot -Force | Out-Null
  Start-LocalUpdateServer
  Write-ArtifactSet

  # Positive lifecycle: C -> A -> B -> restart B -> rollback A -> restart A.
  Write-CurrentVersion '0.4.1'
  Invoke-Installer -Version '0.4.0'
  $exe = Find-DevExe
  # App userData/DSH_HOME must live on the local sandbox C: drive: the mapped
  # evidence folder is a network share and does not support junction creation.
  $userData = Join-Path $localRoot 'userdata'
  $dshHome = Join-Path $localRoot 'dsh-home'

  # 1. C downloads/installs A.
  $p = Start-App -Exe $exe -Phase 'install' -JournalPath (Join-Path $EvidenceDir 'journal-c-to-a.json') -UserData $userData -DshHome $dshHome
  Wait-AppExit $p
  Wait-InstallerDone




  if ($Scenario -eq 'installer-failure' -or $Scenario -eq 'cancel-install') {
    Write-CurrentVersion '0.4.2'
    if ($Scenario -eq 'installer-failure') {
      $env:DSH_DESKTOP_E2E_INSTALLER_FAIL = '1'
    } else {
      $env:DSH_DESKTOP_E2E_INSTALLER_CANCEL = '1'
    }
    try {
      $p = Start-App -Exe $exe -Phase 'install' -JournalPath (Join-Path $EvidenceDir 'journal-a-to-b-fail.json') -UserData $userData -DshHome $dshHome
      Wait-AppExit $p
    } finally {
      Remove-Item Env:DSH_DESKTOP_E2E_INSTALLER_FAIL -ErrorAction SilentlyContinue
      Remove-Item Env:DSH_DESKTOP_E2E_INSTALLER_CANCEL -ErrorAction SilentlyContinue
    }
    $statePath = Join-Path $userData 'update-center.json'
    $state = [System.IO.File]::ReadAllText($statePath, [System.Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
    if ($null -eq $state.installPending) { throw 'installPending was lost after installer launch failure/cancel.' }
    if ($null -eq $state.previousDesktop) { throw 'previousDesktop was lost after installer launch failure/cancel.' }
    $localEvidence = Join-Path $EvidenceDir 'local-state'
    & robocopy.exe $localRoot $localEvidence /E /SL /R:0 /W:0 /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    if ($Scenario -eq 'installer-failure') {
      Set-Content -LiteralPath (Join-Path $EvidenceDir 'E2E_OK_NEG_INSTALLER_FAIL') -Value 'installer failure passed' -Encoding Ascii
      Write-Output 'E2E_OK_NEG_INSTALLER_FAIL'
    } else {
      Set-Content -LiteralPath (Join-Path $EvidenceDir 'E2E_OK_NEG_CANCEL_INSTALL') -Value 'cancel install passed' -Encoding Ascii
      Write-Output 'E2E_OK_NEG_CANCEL_INSTALL'
    }
    return
  }
  # 2. A first boot confirms A and downloads/installs B.
  Write-CurrentVersion '0.4.2'
  $p = Start-App -Exe $exe -Phase 'install' -JournalPath (Join-Path $EvidenceDir 'journal-a-to-b.json') -UserData $userData -DshHome $dshHome
  Wait-AppExit $p
  Wait-InstallerDone

  # 3. B first boot confirms; restart once to prove A is retained.
  $p = Start-App -Exe $exe -Phase 'confirm' -JournalPath (Join-Path $EvidenceDir 'journal-b-confirm-1.json') -UserData $userData -DshHome $dshHome
  Wait-JournalStage -JournalPath (Join-Path $EvidenceDir 'journal-b-confirm-1.json') -Stage 'after-confirmDesktopLifecycle'
  Wait-RealWindow $p -Phase 'b-confirm-1'
  Stop-AppTree $p

  $p = Start-App -Exe $exe -Phase 'verify' -JournalPath (Join-Path $EvidenceDir 'journal-b-verify-1.json') -UserData $userData -DshHome $dshHome
  Wait-JournalStage -JournalPath (Join-Path $EvidenceDir 'journal-b-verify-1.json') -Stage 'after-confirmDesktopLifecycle'
  Wait-RealWindow $p -Phase 'b-verify-1'
  Stop-AppTree $p

  if ($Scenario -eq 'tamper') {
    $aInstaller = Get-ChildItem -Path (Join-Path $userData 'updates\downloads') -Filter '*0.4.1*setup*.exe' -ErrorAction Stop | Select-Object -First 1
    if ($null -eq $aInstaller) { throw 'A installer not found for tamper scenario.' }
    Add-Content -LiteralPath $aInstaller.FullName -Value 'TAMPER' -Encoding Ascii
    $p = Start-App -Exe $exe -Phase 'tamper' -JournalPath (Join-Path $EvidenceDir 'journal-b-tamper.json') -UserData $userData -DshHome $dshHome
    Wait-JournalStage -JournalPath (Join-Path $EvidenceDir 'journal-b-tamper.json') -Stage 'rollback-refused'
    Stop-AppTree $p
    $statePath = Join-Path $userData 'update-center.json'
    $state = [System.IO.File]::ReadAllText($statePath, [System.Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
    if ($null -eq $state.previousDesktop) { throw 'previousDesktop was cleared after tamper refusal.' }
    if ($null -ne $state.rollbackPending) { throw 'rollbackPending was set after tamper refusal.' }
    $localEvidence = Join-Path $EvidenceDir 'local-state'
    & robocopy.exe $localRoot $localEvidence /E /SL /R:0 /W:0 /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    Set-Content -LiteralPath (Join-Path $EvidenceDir 'E2E_OK_NEG_TAMPER') -Value 'tamper refusal passed' -Encoding Ascii
    Write-Output 'E2E_OK_NEG_TAMPER'
    return
  }

  if ($Scenario -eq 'repeat-rollback' -or $Scenario -eq 'target-not-booted') {
    # First rollback: persist rollbackPending, then stop the installer before A
    # boots so the next launch is still B and the pending state is unconfirmed.
    $p = Start-App -Exe $exe -Phase 'rollback' -JournalPath (Join-Path $EvidenceDir 'journal-b-rollback-1.json') -UserData $userData -DshHome $dshHome
    Wait-AppExit $p
    Stop-Installer
    $statePath = Join-Path $userData 'update-center.json'
    $state = [System.IO.File]::ReadAllText($statePath, [System.Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
    if ($null -eq $state.previousDesktop) { throw 'previousDesktop was lost after first rollback.' }
    if ($null -eq $state.rollbackPending) { throw 'rollbackPending was not persisted after first rollback.' }

    if ($Scenario -eq 'repeat-rollback') {
      $p = Start-App -Exe $exe -Phase 'rollback' -JournalPath (Join-Path $EvidenceDir 'journal-b-rollback-2.json') -UserData $userData -DshHome $dshHome
      Wait-AppExit $p
      Stop-Installer
      $state2 = [System.IO.File]::ReadAllText($statePath, [System.Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
      if ($null -eq $state2.rollbackPending) { throw 'repeat rollback did not keep rollbackPending.' }
      $localEvidence = Join-Path $EvidenceDir 'local-state'
      & robocopy.exe $localRoot $localEvidence /E /SL /R:0 /W:0 /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
      Set-Content -LiteralPath (Join-Path $EvidenceDir 'E2E_OK_NEG_REPEAT_ROLLBACK') -Value 'repeat rollback passed' -Encoding Ascii
      Write-Output 'E2E_OK_NEG_REPEAT_ROLLBACK'
      return
    }

    $p = Start-App -Exe $exe -Phase 'target-not-booted' -JournalPath (Join-Path $EvidenceDir 'journal-b-target-not-booted.json') -UserData $userData -DshHome $dshHome
    Wait-JournalStage -JournalPath (Join-Path $EvidenceDir 'journal-b-target-not-booted.json') -Stage 'after-confirmDesktopLifecycle-target-not-booted'
    Stop-AppTree $p
    $state2 = [System.IO.File]::ReadAllText($statePath, [System.Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
    if ($null -eq $state2.rollbackPending) { throw 'rollbackPending was cleared before target version booted.' }
    $localEvidence = Join-Path $EvidenceDir 'local-state'
    & robocopy.exe $localRoot $localEvidence /E /SL /R:0 /W:0 /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    Set-Content -LiteralPath (Join-Path $EvidenceDir 'E2E_OK_NEG_TARGET_NOT_BOOTED') -Value 'target-not-booted passed' -Encoding Ascii
    Write-Output 'E2E_OK_NEG_TARGET_NOT_BOOTED'
    return
  }

  # 4. B rolls back to A.
  $p = Start-App -Exe $exe -Phase 'rollback' -JournalPath (Join-Path $EvidenceDir 'journal-b-rollback.json') -UserData $userData -DshHome $dshHome
  Wait-AppExit $p
  Wait-InstallerDone

  # 5. A confirms rollback and is restarted to prove no residue.
  $p = Start-App -Exe $exe -Phase 'confirm' -JournalPath (Join-Path $EvidenceDir 'journal-a-rollback-confirm.json') -UserData $userData -DshHome $dshHome
  Wait-JournalStage -JournalPath (Join-Path $EvidenceDir 'journal-a-rollback-confirm.json') -Stage 'after-confirmDesktopLifecycle'
  Wait-RealWindow $p -Phase 'a-rollback-confirm'
  Stop-AppTree $p

  $p = Start-App -Exe $exe -Phase 'verify' -JournalPath (Join-Path $EvidenceDir 'journal-a-verify.json') -UserData $userData -DshHome $dshHome
  Wait-JournalStage -JournalPath (Join-Path $EvidenceDir 'journal-a-verify.json') -Stage 'after-confirmDesktopLifecycle'
  Wait-RealWindow $p -Phase 'a-verify'
  Stop-AppTree $p

  Assert-FinalUpdateCenter -StatePath (Join-Path $userData 'update-center.json')

  $localEvidence = Join-Path $EvidenceDir 'local-state'
  & robocopy.exe $localRoot $localEvidence /E /SL /R:0 /W:0 /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
  Set-Content -LiteralPath (Join-Path $EvidenceDir 'E2E_OK') -Value 'positive lifecycle passed' -Encoding Ascii
  Write-Output 'E2E_OK'
} catch {
  Write-Output "E2E_FAIL $($_.Exception.Message)"
  Set-Content -LiteralPath (Join-Path $EvidenceDir 'E2E_FAIL') -Value $_.Exception.Message -Encoding Ascii
  throw
} finally {
  Stop-LocalUpdateServer
}
