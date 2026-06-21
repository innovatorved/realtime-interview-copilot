# WinGet manifests

WinGet manifests for Realtime Interview Copilot Beta, kept in this repo under `winget/`. CI bumps them on each release.

## Install (one command)

```powershell
irm https://raw.githubusercontent.com/innovatorved/realtime-interview-copilot/main/winget/install.ps1 | iex
```

Requires [WinGet](https://apps.microsoft.com/detail/9nblggh4nns1) (App Installer from Microsoft Store).

## Upgrade

Re-run the install script (it detects an existing install and runs `winget upgrade`):

```powershell
irm https://raw.githubusercontent.com/innovatorved/realtime-interview-copilot/main/winget/install.ps1 | iex
```

## Uninstall

```powershell
winget uninstall -e --id Innovatorved.RealtimeInterviewCopilot
```

## Manual install (local manifests)

```powershell
winget install -e --id Innovatorved.RealtimeInterviewCopilot --manifest .\winget\manifests\i\Innovatorved\RealtimeInterviewCopilot\0.14.0-beta
```

Replace the version folder with the latest entry in `LATEST`.

## Validate manifests (maintainers)

```powershell
winget validate .\winget\manifests
```

## Unsigned builds

Windows installers are not code-signed. WinGet will install the app, but Windows SmartScreen may warn on first launch. Use **More info → Run anyway** if prompted.

## Maintainer sync

`scripts/update-winget-manifest.js` regenerates version, URL, and SHA256 from release assets. CI runs it after each GitHub Release and commits the updated `winget/` folder to `main`.
