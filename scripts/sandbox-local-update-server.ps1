param(
  [Parameter(Mandatory = $true)][string]$PackagesDir,
  [Parameter(Mandatory = $true)][string]$CurrentFile,
  [Parameter(Mandatory = $true)][string[]]$RequiredVersions,
  [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'

# When launched through powershell.exe -File, a comma-separated value arrives as
# a single-element [string[]]; normalize it so both direct and -File callers work.
if ($RequiredVersions.Count -eq 1 -and $RequiredVersions[0] -match ',') {
  $RequiredVersions = $RequiredVersions[0] -split ','
}

$VERSION_PATTERN = '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$'
$requiredSet = @{}
foreach ($v in $RequiredVersions) {
  if ($v -notmatch $VERSION_PATTERN) {
    throw "RequiredVersions contains an invalid version: $v"
  }
  $requiredSet[$v] = $true
}

function Test-StrictVersion {
  param([string]$Version)
  return $Version -match $VERSION_PATTERN
}

function Get-RequiredVersionOrThrow {
  param([string]$Version, [string]$Label)
  if (-not (Test-StrictVersion -Version $Version)) {
    throw "$Label version is not a strict release version: $Version"
  }
  if (-not $requiredSet.ContainsKey($Version)) {
    throw "$Label version is not in RequiredVersions: $Version"
  }
  return $Version
}

function Read-CurrentVersion {
  $text = (Get-Content -LiteralPath $CurrentFile -Raw -ErrorAction Stop).Trim()
  return Get-RequiredVersionOrThrow -Version $text -Label 'current.txt'
}

function Test-Package {
  param([string]$Version, [string]$PackagesDir)
  $versionDir = Join-Path $PackagesDir $Version
  $installerName = "DeepSeek-Harness-Personal-Dev-$Version-setup-x64.exe"
  $installerPath = Join-Path $versionDir $installerName
  $manifestPath = Join-Path $versionDir 'client-release-manifest.json'
  $shaPath = Join-Path $versionDir "$installerName.sha256"
  $receiptPath = Join-Path $versionDir 'build-receipt.json'
  if (-not (Test-Path $installerPath)) { throw "installer missing for $Version : $installerPath" }
  if (-not (Test-Path $manifestPath)) { throw "manifest missing for $Version : $manifestPath" }
  if (-not (Test-Path $shaPath)) { throw "sha256 missing for $Version : $shaPath" }
  if (-not (Test-Path $receiptPath)) { throw "build receipt missing for $Version : $receiptPath" }

  $actual = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLower()
  $shaLine = (Get-Content -LiteralPath $shaPath -TotalCount 1)
  $declared = (($shaLine -split '\s+')[0]).ToLower()
  if ($actual -ne $declared) { throw "sha256 mismatch for $Version : $actual != $declared" }

  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.clientVersion -ne $Version) { throw "manifest clientVersion mismatch for $Version : $($manifest.clientVersion)" }
  if ($manifest.installerSha256.ToLower() -ne $actual) { throw "manifest installerSha256 mismatch for $Version" }

  $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  if ($receipt.flavor -ne 'dev') { throw "build receipt flavor for $Version is not dev: $($receipt.flavor)" }
  if ($receipt.e2eBuild -ne $true) { throw "build receipt e2eBuild for $Version is not true" }
  if ($receipt.clientVersion -ne $Version) { throw "build receipt clientVersion mismatch for $Version : $($receipt.clientVersion)" }
  if ($null -eq $receipt.driverSchemaVersion -or $null -eq $receipt.driverVersion) {
    throw "build receipt for $Version is missing the Dev-E2E driver schema/version"
  }
  if ($receipt.installerSha256 -ne $actual) { throw "build receipt installerSha256 mismatch for $Version" }
  if ($receipt.packagedTreeHash -notmatch '^[0-9a-f]{64}$') { throw "build receipt packagedTreeHash missing for $Version" }
}

# Preflight: every required package must be present, internally consistent, and
# carry a Dev-E2E driver build receipt.
foreach ($v in $RequiredVersions) {
  Test-Package -Version $v -PackagesDir $PackagesDir
}
Write-Output "PREFLIGHT_OK versions=$($RequiredVersions -join ',')"

function Get-ReleaseObject {
  param([string]$Version, [string]$PackagesDir, [int]$Port)
  $versionDir = Join-Path $PackagesDir $Version
  $installerName = "DeepSeek-Harness-Personal-Dev-$Version-setup-x64.exe"
  $installerPath = Join-Path $versionDir $installerName
  $manifestPath = Join-Path $versionDir 'client-release-manifest.json'
  $installerSize = (Get-Item $installerPath).Length
  $shaLine = (Get-Content (Join-Path $versionDir "$installerName.sha256") -TotalCount 1)
  $sha = (($shaLine -split '\s+')[0]).ToLower()
  $release = [ordered]@{
    tag_name = "v$Version"
    name = "v$Version"
    draft = $false
    prerelease = $false
    published_at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    body = "E2E $Version"
    html_url = "http://127.0.0.1:$Port/releases/v$Version"
    assets = @(
      [ordered]@{
        name = $installerName
        size = $installerSize
        digest = "sha256:$sha"
        browser_download_url = "http://127.0.0.1:$Port/repos/cyrus/personal/releases/download/v$Version/$installerName"
      },
      [ordered]@{
        name = 'client-release-manifest.json'
        size = (Get-Item $manifestPath).Length
        browser_download_url = "http://127.0.0.1:$Port/repos/cyrus/personal/releases/download/v$Version/client-release-manifest.json"
      }
    )
  }
  return $release
}

function Get-ReleasesArrayJson {
  param([string]$Version, [string]$PackagesDir, [int]$Port)
  $release = Get-ReleaseObject -Version $Version -PackagesDir $PackagesDir -Port $Port
  $single = $release | ConvertTo-Json -Depth 6
  return '[' + $single + ']'
}

function Get-LatestReleaseJson {
  param([string]$Version, [string]$PackagesDir, [int]$Port)
  $release = Get-ReleaseObject -Version $Version -PackagesDir $PackagesDir -Port $Port
  return $release | ConvertTo-Json -Depth 6
}

function Resolve-SafeAssetPath {
  param([string]$Version, [string]$Asset, [string]$PackagesDir)
  Get-RequiredVersionOrThrow -Version $Version -Label 'URL'
  if ([string]::IsNullOrEmpty($Asset) -or $Asset -match '[/\\]' -or $Asset -match '\.\.' -or $Asset -match '[\u0000-\u001f]') {
    throw "Unsafe asset name: $Asset"
  }
  $versionRoot = [System.IO.Path]::GetFullPath((Join-Path $PackagesDir $Version))
  $candidate = [System.IO.Path]::GetFullPath((Join-Path $versionRoot $Asset))
  $prefix = $versionRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $candidate.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Asset escapes version directory: $Asset"
  }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    throw "Asset not found: $Asset"
  }
  return $candidate
}

function Write-Response {
  param($Response, [byte[]]$Body, [string]$ContentType = 'application/octet-stream')
  $Response.StatusCode = 200
  $Response.ContentType = $ContentType
  $Response.ContentLength64 = $Body.Length
  $Response.OutputStream.Write($Body, 0, $Body.Length)
  $Response.OutputStream.Close()
}

function Write-ErrorResponse {
  param($Response, [int]$StatusCode, [string]$Message)
  try {
    $Response.StatusCode = $StatusCode
    $Response.ContentType = 'text/plain; charset=utf-8'
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Message)
    $Response.ContentLength64 = $bytes.Length
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Response.OutputStream.Close()
  } catch {
    try { $Response.OutputStream.Close() } catch {}
  }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Output "LISTENING http://127.0.0.1:$Port packages=$PackagesDir current=$CurrentFile"

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  $path = $req.Url.AbsolutePath
  Write-Output "REQ $($req.HttpMethod) $path"
  try {
    if ($req.HttpMethod -ne 'GET') {
      Write-ErrorResponse -Response $res -StatusCode 405 -Message 'Method Not Allowed'
      continue
    }
    if ($path -match '^/repos/[^/]+/[^/]+/releases$') {
      $version = Read-CurrentVersion
      $json = Get-ReleasesArrayJson -Version $version -PackagesDir $PackagesDir -Port $Port
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
      Write-Response -Response $res -Body $bytes -ContentType 'application/json'
    }
    elseif ($path -match '^/repos/[^/]+/[^/]+/releases/latest$') {
      $version = Read-CurrentVersion
      $json = Get-LatestReleaseJson -Version $version -PackagesDir $PackagesDir -Port $Port
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
      Write-Response -Response $res -Body $bytes -ContentType 'application/json'
    }
    elseif ($path -match '^/repos/[^/]+/[^/]+/releases/download/redirect/v([^/]+)/([^/]+)$') {
      $version = [System.Uri]::UnescapeDataString($Matches[1])
      $asset = [System.Uri]::UnescapeDataString($Matches[2])
      Get-RequiredVersionOrThrow -Version $version -Label 'URL'
      if ([string]::IsNullOrEmpty($asset) -or $asset -match '[/\\]' -or $asset -match '\.\.') {
        throw "Unsafe redirect asset name: $asset"
      }
      $target = "http://127.0.0.1:$Port/repos/cyrus/personal/releases/download/v$version/$asset"
      $res.StatusCode = 302
      $res.RedirectLocation = $target
      $res.OutputStream.Close()
    }
    elseif ($path -match '^/repos/[^/]+/[^/]+/releases/download/redirect-external/v([^/]+)/([^/]+)$') {
      $version = [System.Uri]::UnescapeDataString($Matches[1])
      $asset = [System.Uri]::UnescapeDataString($Matches[2])
      Get-RequiredVersionOrThrow -Version $version -Label 'URL'
      if ([string]::IsNullOrEmpty($asset) -or $asset -match '[/\\]' -or $asset -match '\.\.') {
        throw "Unsafe redirect asset name: $asset"
      }
      $target = "http://127.0.0.2:$Port/repos/cyrus/personal/releases/download/v$version/$asset"
      $res.StatusCode = 302
      $res.RedirectLocation = $target
      $res.OutputStream.Close()
    }
    elseif ($path -match '^/repos/[^/]+/[^/]+/releases/download/v([^/]+)/([^/]+)$') {
      $version = [System.Uri]::UnescapeDataString($Matches[1])
      $asset = [System.Uri]::UnescapeDataString($Matches[2])
      if (-not (Test-StrictVersion -Version $version) -or -not $requiredSet.ContainsKey($version)) {
        Write-ErrorResponse -Response $res -StatusCode 404 -Message "Unknown version: $version"
        continue
      }
      if ([string]::IsNullOrEmpty($asset) -or $asset -match '[/\\]' -or $asset -match '\.\.' -or $asset -match '[\u0000-\u001f]') {
        Write-ErrorResponse -Response $res -StatusCode 400 -Message "Unsafe asset name: $asset"
        continue
      }
      $versionRoot = [System.IO.Path]::GetFullPath((Join-Path $PackagesDir $Version))
      $candidate = [System.IO.Path]::GetFullPath((Join-Path $versionRoot $asset))
      $prefix = $versionRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
      if (-not $candidate.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        Write-ErrorResponse -Response $res -StatusCode 400 -Message "Asset escapes version directory: $asset"
        continue
      }
      if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        Write-ErrorResponse -Response $res -StatusCode 404 -Message "Asset not found: $asset"
        continue
      }
      $bytes = [System.IO.File]::ReadAllBytes($candidate)
      $contentType = if ($asset -like '*.json') { 'application/json' } else { 'application/octet-stream' }
      Write-Response -Response $res -Body $bytes -ContentType $contentType
    }
    else {
      Write-ErrorResponse -Response $res -StatusCode 404 -Message 'Not Found'
    }
  } catch {
    $message = $_.Exception.Message
    Write-ErrorResponse -Response $res -StatusCode 500 -Message $message
  }
}
