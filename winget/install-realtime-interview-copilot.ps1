#Requires -Version 5.1
<#
.SYNOPSIS
  Install or upgrade Realtime Interview Copilot Beta via WinGet.

.EXAMPLE
  irm https://raw.githubusercontent.com/innovatorved/winget/main/install-realtime-interview-copilot.ps1 | iex
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$installUri = 'https://raw.githubusercontent.com/innovatorved/winget/main/install.ps1'
$installScript = (Invoke-WebRequest -Uri $installUri -UseBasicParsing).Content
. ([scriptblock]::Create($installScript))

Install-InnovatorvedPackage `
    -PackageId 'Innovatorved.RealtimeInterviewCopilot' `
    -DisplayName 'Realtime Interview Copilot Beta'
