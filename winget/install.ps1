#Requires -Version 5.1
<#
.SYNOPSIS
  Shared WinGet installer for Innovatorved packages.

.DESCRIPTION
  Downloads manifests from github.com/innovatorved/winget and runs winget
  install/upgrade against the local manifest path.

.NOTES
  Do not run this file directly via irm | iex. Use a per-app wrapper script
  such as install-realtime-interview-copilot.ps1.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:HubRepo = 'https://github.com/innovatorved/winget'

function Ensure-Winget {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        return
    }
    Write-Error @"
WinGet is not available on this system.
Install the App Installer from the Microsoft Store, then re-run:
  https://apps.microsoft.com/detail/9nblggh4nns1
"@
}

function Get-PackageFolderFromId {
    param([string]$PackageId)
    if ($PackageId -notmatch '^([^.]+)\.(.+)$') {
        throw "Invalid PackageId format (expected Publisher.AppName): $PackageId"
    }
    return @{
        Publisher = $Matches[1]
        AppFolder = $Matches[2]
    }
}

function Resolve-ManifestFromHubZip {
    param(
        [string]$ZipPath,
        [string]$ExtractRoot,
        [string]$PackageId
    )

    Expand-Archive -Path $ZipPath -DestinationPath $ExtractRoot -Force
    $repoDir = Get-ChildItem -Path $ExtractRoot -Directory | Select-Object -First 1
    if (-not $repoDir) {
        throw "Could not find extracted winget hub under $ExtractRoot"
    }

    $parts = Get-PackageFolderFromId -PackageId $PackageId
    $publisher = $parts.Publisher
    $appFolder = $parts.AppFolder

    $latestFile = Join-Path $repoDir.FullName "packages\$appFolder\LATEST"
    $version = $null
    if (Test-Path $latestFile) {
        $version = (Get-Content $latestFile -Raw).Trim()
    }

    $manifestRoot = Join-Path $repoDir.FullName "manifests\i\$publisher\$appFolder"
    if (-not (Test-Path $manifestRoot)) {
        throw "No manifests found at $manifestRoot"
    }

    if (-not $version) {
        $versionDir = Get-ChildItem -Path $manifestRoot -Directory |
            Sort-Object Name -Descending |
            Select-Object -First 1
        if (-not $versionDir) {
            throw "No version folders under $manifestRoot"
        }
        $version = $versionDir.Name
    }

    $manifestPath = Join-Path $manifestRoot $version
    if (-not (Test-Path $manifestPath)) {
        throw "Manifest path not found: $manifestPath"
    }

    return @{
        Version = $version
        ManifestPath = $manifestPath
    }
}

function Install-InnovatorvedPackage {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PackageId,

        [string]$DisplayName = $PackageId
    )

    Ensure-Winget

    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("winget-hub-" + [guid]::NewGuid().ToString('n'))
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

    try {
        $zipPath = Join-Path $tempRoot 'hub.zip'
        $zipUrl = "$script:HubRepo/archive/refs/heads/main.zip"
        Write-Host "→ Downloading manifests from $script:HubRepo ..."
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

        $extractRoot = Join-Path $tempRoot 'extract'
        New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
        $info = Resolve-ManifestFromHubZip -ZipPath $zipPath -ExtractRoot $extractRoot -PackageId $PackageId

        Write-Host "→ Using manifest version $($info.Version)"

        $wingetArgs = @(
            '-e'
            '--id', $PackageId
            '--manifest', $info.ManifestPath
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
        Write-Host "✅ $DisplayName $($info.Version) is ready."
        Write-Host "   Windows builds are unsigned; SmartScreen may prompt on first launch."
        Write-Host "   Choose 'More info' → 'Run anyway' if needed."
    }
    finally {
        Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
