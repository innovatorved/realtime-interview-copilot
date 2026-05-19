# Synced to github.com/innovatorved/homebrew-tap by CI.
# DMG name must match package.json build.artifactName (URL-safe, no spaces).
# `scripts/update-homebrew-cask.js` only rewrites the `version` and `sha256`
# stanzas — keep them on their own lines so the find/replace stays anchored.
# The url uses #{version} so the Git tag (v0.x.x) and filename stay aligned.

cask "realtime-interview-copilot" do
  version "0.7.0-beta"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/innovatorved/realtime-interview-copilot/releases/download/v#{version}/Realtime.Interview.Copilot.Beta-#{version}-mac-arm64.dmg",
      verified: "github.com/innovatorved/realtime-interview-copilot/"
  name "Realtime Interview Copilot Beta"
  desc "Real-time AI copilot for interviews (beta)"
  homepage "https://github.com/innovatorved/realtime-interview-copilot"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on arch: :arm64
  depends_on macos: ">= :big_sur"

  app "Realtime Interview Copilot Beta.app"

  # The build is currently unsigned (no Apple Developer ID notarisation yet),
  # so the DMG ships with the `com.apple.quarantine` extended attribute.
  # Since macOS 14.4 the old "right-click → Open" Gatekeeper bypass is gone,
  # which is why users were being pushed into System Settings → Privacy &
  # Security → "Open Anyway" before the app would launch. Stripping the
  # quarantine attr in `postflight` lets the cask-installed app open with a
  # single click, mirroring the UX of a signed/notarised cask.
  # Once the build is signed + notarised this block can be removed.
  postflight do
    system_command "/usr/bin/xattr",
                   args:  ["-dr", "com.apple.quarantine",
                           "#{appdir}/Realtime Interview Copilot Beta.app"],
                   sudo:  false
  end

  uninstall quit: "com.realtime.interview.copilot.beta"

  zap trash: [
    "~/Library/Application Support/Realtime Interview Copilot Beta",
    "~/Library/Caches/com.realtime.interview.copilot.beta",
    "~/Library/Logs/Realtime Interview Copilot Beta",
    "~/Library/Preferences/com.realtime.interview.copilot.beta.plist",
    "~/Library/Saved Application State/com.realtime.interview.copilot.beta.savedState",
  ]

  caveats <<~EOS
    Realtime Interview Copilot Beta is distributed unsigned (no Apple
    Developer ID notarisation yet). This cask clears the macOS quarantine
    attribute on install so the app launches with one click.

    If macOS still blocks it (e.g. after a manual DMG install), run:

      xattr -dr com.apple.quarantine "/Applications/Realtime Interview Copilot Beta.app"

    Apple Silicon (arm64) only for now. The app needs Microphone and
    Screen Recording permission (System Settings → Privacy & Security)
    for the live transcription and Ask AI screenshot features.
  EOS
end
