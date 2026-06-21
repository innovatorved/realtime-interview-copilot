# Innovatorved WinGet manifests

Central private WinGet manifest repository for [Innovatorved](https://github.com/innovatorved) Windows apps. Mirrors the [homebrew-tap](https://github.com/innovatorved/homebrew-tap) pattern for macOS.

Requires [WinGet](https://apps.microsoft.com/detail/9nblggh4nns1) (App Installer from the Microsoft Store).

## Packages

| App | Package ID | Install |
| --- | --- | --- |
| [Realtime Interview Copilot Beta](https://github.com/innovatorved/realtime-interview-copilot) | `Innovatorved.RealtimeInterviewCopilot` | `irm https://raw.githubusercontent.com/innovatorved/winget/main/install-realtime-interview-copilot.ps1 \| iex` |

---

## Realtime Interview Copilot Beta

**Install**

```powershell
irm https://raw.githubusercontent.com/innovatorved/winget/main/install-realtime-interview-copilot.ps1 | iex
```

**Upgrade** — re-run the install command above.

**Uninstall**

```powershell
winget uninstall -e --id Innovatorved.RealtimeInterviewCopilot
```

Windows builds are unsigned. WinGet will install the app, but SmartScreen may warn on first launch. Use **More info → Run anyway** if prompted.

---

## Maintainers

Each app repo keeps a working copy under `winget/` (manifests + package version pointer). On release, CI in the app repo runs `scripts/update-winget-manifest.js` and pushes updated manifests to this hub (same token pattern as `HOMEBREW_TAP_TOKEN`).

To add a new app:

1. Add manifests under `manifests/i/Innovatorved/<AppName>/`
2. Add `packages/<AppName>/LATEST`
3. Add `install-<app-slug>.ps1` wrapper calling shared `install.ps1`
4. Update the packages table in this README

**Validate manifests (Windows)**

```powershell
winget validate .\manifests
```
