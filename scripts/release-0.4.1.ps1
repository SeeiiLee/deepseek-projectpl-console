$ErrorActionPreference = 'Stop'
$token = [System.IO.File]::ReadAllText('F:\QClawData\workspace\secure\github_token.txt').Trim()
$headers = @{
  'Authorization' = "Bearer $token"
  'Accept' = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent' = 'dsh-release-script'
}
$repo = 'SeeiiLee/deepseek-projectpl-console'
$tag = 'v0.4.1'
$bodyText = [string](Get-Content -Raw -Encoding UTF8 'docs\release-notes\0.4.1.md')

$existing = $null
try {
  $existing = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" -Method Get
} catch {
  Write-Output 'no existing release for tag (expected for first publish)'
}
if ($existing) {
  Write-Output "release already exists: $($existing.id)"
  $release = $existing
} else {
  $payload = @{
    tag_name = $tag
    name = "DeepSeek Harness Personal v0.4.1"
    body = $bodyText
    draft = $false
    prerelease = $false
  }
  $json = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $payload -Depth 5))
  $release = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$repo/releases" -Method Post -Body $json -ContentType 'application/json; charset=utf-8'
  Write-Output "created release id=$($release.id) url=$($release.html_url)"
}

$uploadUrl = ($release.upload_url -replace '\{\?name,label\}$', '')
$existingAssets = @()
try {
  $page = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$repo/releases/$($release.id)/assets?per_page=100" -Method Get
  $existingAssets = @($page | ForEach-Object { $_.name })
} catch {}
$assets = @(
  'artifacts\DeepSeek-Harness-Personal-0.4.1-setup-x64.exe',
  'artifacts\DeepSeek-Harness-Personal-0.4.1-setup-x64.exe.sha256',
  'artifacts\DeepSeek-Harness-Personal-0.4.1-setup-x64.exe.blockmap',
  'artifacts\DeepSeek-Harness-Personal-0.4.1-portable-x64.exe',
  'artifacts\DeepSeek-Harness-Personal-0.4.1-portable-x64.exe.sha256'
)
foreach ($asset in $assets) {
  $name = Split-Path $asset -Leaf
  if ($existingAssets -contains $name) { Write-Output "skip existing asset $name"; continue }
  $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $asset))
  $uri = "${uploadUrl}?name=$name"
  try {
    $result = Invoke-RestMethod -Headers $headers -Uri $uri -Method Post -Body $bytes -ContentType 'application/octet-stream'
    Write-Output "uploaded $name ($($result.size) bytes)"
  } catch {
    Write-Output "FAILED $name : $($_.Exception.Message)"
  }
}
Write-Output 'RELEASE_DONE'
