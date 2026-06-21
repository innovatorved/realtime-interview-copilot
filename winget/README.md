WinGet manifests for this app are published to the central [innovatorved/winget](https://github.com/innovatorved/winget) hub.

**Install (Windows):**

```powershell
irm https://raw.githubusercontent.com/innovatorved/winget/main/install-realtime-interview-copilot.ps1 | iex
```

**CI:** `WINGET_TOKEN` must have Contents write on `innovatorved/winget`. Homebrew tap updates use `HOMEBREW_TAP_TOKEN` separately.
