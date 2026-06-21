# WinGet manifests for Realtime Interview Copilot

Private WinGet manifest repo for [Realtime Interview Copilot Beta](https://github.com/innovatorved/realtime-interview-copilot). Manifests are auto-bumped on each app release by CI in the main repo.

## Install (one command)

```powershell
irm https://raw.githubusercontent.com/innovatorved/winget/main/install.ps1 | iex
```

Requires [WinGet](https://apps.microsoft.com/detail/9nblggh4nns1) (App Installer from Microsoft Store).

## Upgrade

Re-run the install script (it detects an existing install and runs `winget upgrade`):

```powershell
irm https://raw.githubusercontent.com/innovatorved/winget/main/install.ps1 | iex
```

## Uninstall

```powershell
winget uninstall -e --id InnovatorVed.RealtimeInterviewCopilot
```

## Manual install (local manifests)

```powershell
winget install -e --id InnovatorVed.RealtimeInterviewCopilot --manifest .\manifests\i\InnovatorVed\RealtimeInterviewCopilot\0.14.0-beta
```

Replace the version folder with the latest entry in `LATEST`.

## Validate manifests (maintainers)

```powershell
winget validate .\manifests
```

## Unsigned builds

Windows installers are not code-signed. WinGet will install the app, but Windows SmartScreen may warn on first launch. Use **More info → Run anyway** if prompted.

## Maintainer sync

CI in `innovatorved/realtime-interview-copilot` pushes updated manifests here when `WINGET_MANIFEST_TOKEN` is configured. The working copy of manifests lives under `winget/` in the main repo.
