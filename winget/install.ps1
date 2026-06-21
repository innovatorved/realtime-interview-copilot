#Requires -Version 5.1
<#
.SYNOPSIS
  Install or upgrade Realtime Interview Copilot Beta via WinGet using private manifests.

.DESCRIPTION
  Downloads the latest manifest bundle from this repo's winget/ folder and runs
  winget install/upgrade against the local manifest path. No winget source registration
  or admin rights are required for source setup.

.EXAMPLE
  irm https://raw.githubusercontent.com/innovatorved/realtime-interview-copilot/main/winget/install.ps1 | iex
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$PackageId = 'Innovatorved.RealtimeInterviewCopilot'
$AppRepo = 'https://github.com/innovatorved/realtime-interview-copilot'
$ZipUrl = "$AppRepo/archive/refs/heads/main.zip"

function Ensure-Winget {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        return
    }
    Write-Error @"
WinGet is not available on this system.
Install the App Installer from the Microsoft Store, then re-run this script:
  https://apps.microsoft.com/detail/9nblggh4nns1
"@
}

function Get-LatestVersionFromZip {
    param([string]$ZipPath, [string]$ExtractRoot)

    Expand-Archive -Path $ZipPath -DestinationPath $ExtractRoot -Force
    $repoDir = Get-ChildItem -Path $ExtractRoot -Directory | Select-Object -First 1
    if (-not $repoDir) {
        throw "Could not find extracted repo under $ExtractRoot"
    }

    $wingetRoot = Join-Path $repoDir.FullName 'winget'
    if (-not (Test-Path $wingetRoot)) {
        throw "No winget/ folder found in $AppRepo"
    }

    $latestFile = Join-Path $wingetRoot 'LATEST'
    if (Test-Path $latestFile) {
        $version = (Get-Content $latestFile -Raw).Trim()
        if ($version) {
            return @{ Version = $version; WingetRoot = $wingetRoot }
        }
    }

    $manifestRoot = Join-Path $wingetRoot 'manifests\i\Innovatorved\RealtimeInterviewCopilot'
    if (-not (Test-Path $manifestRoot)) {
        throw "No manifests found at $manifestRoot"
    }

    $versionDir = Get-ChildItem -Path $manifestRoot -Directory |
        Sort-Object Name -Descending |
        Select-Object -First 1
    if (-not $versionDir) {
        throw "No version folders under $manifestRoot"
    }

    return @{ Version = $versionDir.Name; WingetRoot = $wingetRoot }
}

Ensure-Winget

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("winget-ric-" + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
    $zipPath = Join-Path $tempRoot 'repo.zip'
    Write-Host "→ Downloading manifests from $AppRepo ..."
    Invoke-WebRequest -Uri $ZipUrl -OutFile $zipPath -UseBasicParsing

    $extractRoot = Join-Path $tempRoot 'extract'
    New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
    $info = Get-LatestVersionFromZip -ZipPath $zipPath -ExtractRoot $extractRoot

    $manifestPath = Join-Path $info.WingetRoot "manifests\i\Innovatorved\RealtimeInterviewCopilot\$($info.Version)"
    if (-not (Test-Path $manifestPath)) {
        throw "Manifest path not found: $manifestPath"
    }

    Write-Host "→ Using manifest version $($info.Version)"

    $wingetArgs = @(
        '-e'
        '--id', $PackageId
        '--manifest', $manifestPath
        '--accept-package-agreements'
        '--accept-source-agreements'
    )

    winget list -e --id $PackageId --accept-source-agreements *> $null
    $installed = ($LASTEXITCODE -eq 0)
    $command = if ($installed) { 'upgrade' } else { 'install' }

    Write-Host "→ Running: winget $command $($wingetArgs -join ' ')"
    & winget $command @wingetArgs
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0 -and $command -eq 'upgrade') {
        $upgradeCheck = winget upgrade @wingetArgs 2>&1 | Out-String
        if ($upgradeCheck -match 'No applicable update|No available upgrade|already installed') {
            Write-Host "→ Already on the latest available version ($($info.Version))."
            $exitCode = 0
        }
    }

    if ($exitCode -ne 0) {
        throw "winget exited with code $exitCode"
    }

    Write-Host ""
    Write-Host "✅ Realtime Interview Copilot Beta $($info.Version) is ready."
    Write-Host "   Windows builds are unsigned; SmartScreen may prompt on first launch."
    Write-Host "   Choose 'More info' → 'Run anyway' if needed."
}
finally {
    Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
