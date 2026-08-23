param(
  [string]$RunId = "e2e-$(Get-Date -Format 'yyyyMMdd-HHmmss')",
  [string]$PackagesRoot = "D:\Deepseek Harness Personal\artifacts-dev\e2e",
  [string]$HarnessRoot = "",
  [string]$NodeExe = "",
  [string]$RunsRoot = "D:\Deepseek Harness Personal\artifacts-dev\e2e-runs",
  [int]$ServerPort = 8765,
  [string]$Scenario = 'positive'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $RunsRoot) { $RunsRoot = Join-Path $repoRoot 'artifacts-dev\e2e-runs' }

function Get-Sha256 {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { throw "File missing for SHA-256: $Path" }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower()
}

$runDir = Join-Path $RunsRoot $RunId
if (Test-Path -LiteralPath $runDir) {
  throw "Run directory already exists; refusing to reuse an existing run: $runDir"
}
if (-not (Test-Path -LiteralPath $RunsRoot)) {
  New-Item -ItemType Directory -Path $RunsRoot | Out-Null
}
$inputDir = Join-Path $runDir 'input'
$evidenceDir = Join-Path $runDir 'evidence'
New-Item -ItemType Directory -Path $runDir | Out-Null
New-Item -ItemType Directory -Path $inputDir | Out-Null
New-Item -ItemType Directory -Path $evidenceDir | Out-Null

# Read-only input: scripts + C/A/B packages + optional Harness runtime.
$scriptNames = @('sandbox-e2e-host.ps1', 'sandbox-e2e-outer.ps1', 'sandbox-local-update-server.ps1')
$scriptShas = @()
foreach ($name in $scriptNames) {
  $sourceScript = Join-Path $PSScriptRoot $name
  $inputScript = Join-Path $inputDir $name
  $sourceScriptSha = Get-Sha256 $sourceScript
  Copy-Item -LiteralPath $sourceScript -Destination $inputScript -Force
  $inputScriptSha = Get-Sha256 $inputScript
  if ($sourceScriptSha -ne $inputScriptSha) {
    throw "SHA mismatch after copying script $name : source=$sourceScriptSha input=$inputScriptSha"
  }
  Write-Output "SCRIPT_SHA_OK $name $sourceScriptSha"
  $scriptShas += [ordered]@{
    name = $name
    sourceSha256 = $sourceScriptSha
    inputSha256 = $inputScriptSha
  }
}
$outerSource = Join-Path $PSScriptRoot 'sandbox-e2e-outer.ps1'
$outerInput = Join-Path $inputDir 'sandbox-e2e-outer.ps1'
if ((Get-Sha256 $outerSource) -ne (Get-Sha256 $outerInput)) {
  throw 'source outer SHA must equal input outer SHA'
}
$packagesInput = Join-Path $inputDir 'packages'
New-Item -ItemType Directory -Path $packagesInput -Force | Out-Null
$sourceShas = @{}
foreach ($version in @('0.4.0', '0.4.1', '0.4.2')) {
  $source = Join-Path $PackagesRoot $version
  if (-not (Test-Path -LiteralPath $source)) { throw "Package directory missing: $source" }
  $installerName = "DeepSeek-Harness-Personal-Dev-$version-setup-x64.exe"
  $sourceInstaller = Join-Path $source $installerName
  if (-not (Test-Path -LiteralPath $sourceInstaller)) { throw "Source installer missing: $sourceInstaller" }
  $sourceSha = (Get-FileHash -LiteralPath $sourceInstaller -Algorithm SHA256).Hash.ToLower()
  Copy-Item -LiteralPath $source -Destination (Join-Path $packagesInput $version) -Recurse -Force
  $inputInstaller = Join-Path $packagesInput "$version\$installerName"
  $inputSha = (Get-FileHash -LiteralPath $inputInstaller -Algorithm SHA256).Hash.ToLower()
  if ($sourceSha -ne $inputSha) {
    throw "SHA mismatch after copying $version : source=$sourceSha input=$inputSha"
  }
  Write-Output "PACKAGE_SHA_OK $version $sourceSha"
  $sourceShas[$version] = [ordered]@{
    role = if ($version -eq '0.4.0') { 'C' } elseif ($version -eq '0.4.1') { 'A' } else { 'B' }
    version = $version
    sourceSha256 = $sourceSha
    inputSha256 = $inputSha
    relativePath = "packages\$version\$installerName"
  }
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$shaVerification = [ordered]@{
  schemaVersion = 1
  runId = $RunId
  verifiedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  artifacts = @($sourceShas.Values)
} | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText((Join-Path $evidenceDir 'input-sha-verification.json'), $shaVerification, $utf8NoBom)
if ($HarnessRoot) {
  if (-not (Test-Path -LiteralPath $HarnessRoot)) { throw "Harness root missing: $HarnessRoot" }
  $harnessLink = Join-Path $inputDir 'harness'
  if (Test-Path -LiteralPath $harnessLink) { Remove-Item -LiteralPath $harnessLink -Force -Recurse }
  Write-Output "COPY_HARNESS $HarnessRoot -> $harnessLink"
  & robocopy.exe $HarnessRoot $harnessLink /E /MT:32 /SL /R:0 /W:0 /XD .git /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
  $harnessItem = Get-Item -LiteralPath $harnessLink -Force
  if ($harnessItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    throw "input/harness must be a real copied directory, not a junction/symlink/reparse point: $harnessLink"
  }
  if ($null -ne $harnessItem.LinkType -and $harnessItem.LinkType) {
    throw "input/harness must not be a link; LinkType=$($harnessItem.LinkType): $harnessLink"
  }
} elseif (Test-Path -LiteralPath (Join-Path $inputDir 'harness')) {
  $harnessItem = Get-Item -LiteralPath (Join-Path $inputDir 'harness') -Force
  if ($harnessItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    throw "Pre-existing input/harness must be a real copied directory, not a junction/symlink/reparse point."
  }
} else {
  Write-Warning 'No -HarnessRoot provided and input has no harness directory; the inner script will fail unless you pre-place a Harness runtime.'
}
if ($NodeExe) {
  if (-not (Test-Path -LiteralPath $NodeExe)) { throw "Node executable missing: $NodeExe" }
  $nodeDir = Join-Path $inputDir 'node'
  New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
  Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $nodeDir 'node.exe') -Force
  Write-Output "NODE_COPIED $(Join-Path $nodeDir 'node.exe')"
}

$sandboxInput = 'C:\Users\WDAGUtilityAccount\Documents\e2e-input'
$sandboxEvidence = 'C:\Users\WDAGUtilityAccount\Documents\e2e-evidence'
$wsb = @"
<Configuration>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>$inputDir</HostFolder>
      <SandboxFolder>$sandboxInput</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
    <MappedFolder>
      <HostFolder>$evidenceDir</HostFolder>
      <SandboxFolder>$sandboxEvidence</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <Networking>Disable</Networking>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <LogonCommand>
    <Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File $sandboxInput\sandbox-e2e-outer.ps1 -InputDir $sandboxInput -EvidenceDir $sandboxEvidence -RunId $RunId -ServerPort $ServerPort -Scenario $Scenario</Command>
  </LogonCommand>
</Configuration>
"@
$wsbPath = Join-Path $runDir "$RunId.wsb"
Set-Content -LiteralPath $wsbPath -Value $wsb -Encoding Utf8
$wsbSha = Get-Sha256 $wsbPath
$runInputManifest = [ordered]@{
  schemaVersion = 1
  runId = $RunId
  createdAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  scripts = $scriptShas
  packages = @($sourceShas.Values)
  wsb = [ordered]@{
    path = $wsbPath
    sha256 = $wsbSha
  }
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$manifestPath = Join-Path $evidenceDir 'run-input-manifest.json'
[System.IO.File]::WriteAllText($manifestPath, ($runInputManifest | ConvertTo-Json -Depth 5), $utf8NoBom)
Write-Output "RUN_INPUT_MANIFEST $manifestPath"

Write-Output "RUN_DIR $runDir"
Write-Output "WSB $wsbPath"
Write-Output "EVIDENCE $evidenceDir"
$sandboxExe = "$env:WINDIR\System32\WindowsSandbox.exe"
if (-not (Test-Path -LiteralPath $sandboxExe)) {
  throw "WindowsSandbox.exe not found at $sandboxExe"
}
Start-Process -FilePath $sandboxExe -ArgumentList "`"$wsbPath`""
Write-Output "SANDBOX_LAUNCHED"
