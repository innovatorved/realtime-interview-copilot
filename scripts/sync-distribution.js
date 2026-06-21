#!/usr/bin/env node

// Writes Homebrew cask + WinGet manifests into cloned hub repos (TAP_DIR / WINGET_DIR).
// Templates are embedded here — no homebrew/ or winget/ folders in the app repo.
// RELEASE_TAG must match semver in artifact filenames (bump package.json before tagging).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SOURCE = { owner: "innovatorved", repo: "realtime-interview-copilot" };
const WINGET = {
  packageId: "Innovatorved.RealtimeInterviewCopilot",
  folder: "RealtimeInterviewCopilot",
};
const HOMEBREW = { cask: "realtime-interview-copilot" };

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const pkgVersion = pkg.version;

let displayName = "Meeting Copilot";
try {
  const constants = JSON.parse(
    fs.readFileSync(path.join(root, "constant.json"), "utf8"),
  );
  if (
    typeof constants.displayName === "string" &&
    constants.displayName.length > 0
  ) {
    displayName = constants.displayName;
  }
} catch {
  /* use default */
}

// Bundled .app name follows electron-builder productName until apply-app-constants runs.
const appBundleName =
  typeof pkg.build?.productName === "string" && pkg.build.productName.length > 0
    ? `${pkg.build.productName}.app`
    : `${displayName}.app`;

const refName = (
  process.env.RELEASE_TAG?.trim() ||
  process.env.GITHUB_REF_NAME?.trim() ||
  ""
).trim();

const refVersion =
  refName === ""
    ? null
    : refName.toLowerCase().startsWith("v")
      ? refName.slice(1)
      : refName;

const assetsDir =
  process.env.RELEASE_ASSETS_DIR?.trim() ||
  path.join(root, "release-assets");

const tapDir = process.env.TAP_DIR?.trim() || "";
const wingetDir = process.env.WINGET_DIR?.trim() || "";

if (!tapDir && !wingetDir) {
  console.error("❌ Set TAP_DIR and/or WINGET_DIR to cloned hub repo paths.");
  process.exit(1);
}

if (!fs.existsSync(assetsDir)) {
  console.error(`❌ release-assets not found at ${assetsDir}`);
  process.exit(1);
}

if (refName) {
  console.log(`→ Release ref: ${refName} (semver ${refVersion})`);
}

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function versionFromDmgFilename(name) {
  const m = name.match(
    /^Realtime[ .]Interview[ .]Copilot[ .]Beta-(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)-mac-arm64\.dmg$/i,
  );
  return m ? m[1] : null;
}

function versionFromExeFilename(name) {
  const m = name.match(
    /^Realtime[ .]Interview[ .]Copilot[ .]Beta-(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)-win-x64\.exe$/i,
  );
  return m ? m[1] : null;
}

function pickAsset(files, refVer, versionFromName, label) {
  const candidates = files
    .map((name) => ({ name, version: versionFromName(name) }))
    .filter((x) => x.version !== null);

  if (candidates.length === 0) {
    console.error(`❌ No matching ${label} in ${assetsDir}`);
    process.exit(1);
  }

  let chosen = null;

  if (refVer) {
    const byTag = candidates.filter((x) => x.version === refVer);
    if (byTag.length >= 1) {
      chosen = byTag[0];
      if (byTag.length > 1) {
        console.warn(`⚠️ Multiple ${label} matched tag; using ${chosen.name}`);
      }
    } else {
      console.error(
        `❌ RELEASE_TAG ${refName} but no ${label} with semver ${refVer}. Found:\n` +
          candidates.map((x) => `  - ${x.name}`).join("\n"),
      );
      process.exit(1);
    }
  }

  if (!chosen) {
    const byPkg = candidates.filter((x) => x.version === pkgVersion);
    if (byPkg.length >= 1) {
      chosen = byPkg[0];
    } else if (candidates.length === 1) {
      chosen = candidates[0];
      console.warn(`⚠️ Using sole ${label}: ${chosen.name}`);
    }
  }

  if (!chosen) {
    console.error(`❌ Could not pick one ${label}.`);
    process.exit(1);
  }

  return chosen;
}

function writeCask(version, sha256) {
  const caskPath = path.join(
    tapDir,
    "Casks",
    `${HOMEBREW.cask}.rb`,
  );
  fs.mkdirSync(path.dirname(caskPath), { recursive: true });

  const contents = `# Synced from ${SOURCE.repo} release CI via scripts/sync-distribution.js
cask "${HOMEBREW.cask}" do
  version "${version}"
  sha256 "${sha256}"

  url "https://github.com/${SOURCE.owner}/${SOURCE.repo}/releases/download/v#{version}/Realtime.Interview.Copilot.Beta-#{version}-mac-arm64.dmg",
      verified: "github.com/${SOURCE.owner}/${SOURCE.repo}/"
  name "${displayName}"
  desc "Real-time AI copilot for interviews (beta)"
  homepage "https://github.com/${SOURCE.owner}/${SOURCE.repo}"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on arch: :arm64
  depends_on macos: :big_sur

  app "${appBundleName}"

  postflight do
    system_command "/usr/bin/xattr",
                   args:  ["-dr", "com.apple.quarantine",
                           "#{appdir}/${appBundleName}"],
                   sudo:  false
  end

  uninstall quit: "com.realtime.interview.copilot.beta"

  zap trash: [
    "~/Library/Application Support/${pkg.build?.productName || displayName}",
    "~/Library/Caches/com.realtime.interview.copilot.beta",
    "~/Library/Logs/${pkg.build?.productName || displayName}",
    "~/Library/Preferences/com.realtime.interview.copilot.beta.plist",
    "~/Library/Saved Application State/com.realtime.interview.copilot.beta.savedState",
  ]

  caveats <<~EOS
    ${displayName} is distributed unsigned (no Apple Developer ID notarisation yet).
    This cask clears the macOS quarantine attribute on install so the app launches with one click.

    If macOS still blocks it (e.g. after a manual DMG install), run:

      xattr -dr com.apple.quarantine "/Applications/${appBundleName}"

    Apple Silicon (arm64) only for now.

    To update: \`brew update && brew upgrade --cask ${HOMEBREW.cask}\`
  EOS
end
`;

  fs.writeFileSync(caskPath, contents);
  console.log(`✅ Wrote cask → ${caskPath}`);
}

function installerUrl(version) {
  return `https://github.com/${SOURCE.owner}/${SOURCE.repo}/releases/download/v${version}/Realtime.Interview.Copilot.Beta-${version}-win-x64.exe`;
}

function writeWingetManifests(version, sha256) {
  const manifestDir = path.join(
    wingetDir,
    "manifests",
    "i",
    "Innovatorved",
    WINGET.folder,
    version,
  );
  fs.mkdirSync(manifestDir, { recursive: true });

  const { packageId } = WINGET;

  fs.writeFileSync(
    path.join(manifestDir, `${packageId}.yaml`),
    `PackageIdentifier: ${packageId}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.6.0
`,
  );

  fs.writeFileSync(
    path.join(manifestDir, `${packageId}.installer.yaml`),
    `PackageIdentifier: ${packageId}
PackageVersion: ${version}
Installers:
  - Architecture: x64
    InstallerType: nullsoft
    InstallerUrl: ${installerUrl(version)}
    InstallerSha256: ${sha256}
    Scope: user
    InstallerSwitches:
      Silent: /S
      SilentWithProgress: /S
    AppsAndFeaturesEntries:
      - DisplayName: ${displayName}
        Publisher: Innovatorved
ManifestType: installer
ManifestVersion: 1.6.0
`,
  );

  fs.writeFileSync(
    path.join(manifestDir, `${packageId}.locale.en-US.yaml`),
    `PackageIdentifier: ${packageId}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: Innovatorved
PublisherUrl: https://github.com/${SOURCE.owner}
PublisherSupportUrl: https://github.com/${SOURCE.owner}/${SOURCE.repo}/issues
PackageName: ${displayName}
PackageUrl: https://github.com/${SOURCE.owner}/${SOURCE.repo}
License: Apache-2.0
LicenseUrl: https://github.com/${SOURCE.owner}/${SOURCE.repo}/blob/main/LICENSE
Copyright: Copyright (c) Ved Gupta
ShortDescription: Real-time AI copilot for interviews (beta)
Description: |-
  Desktop app for live interview assistance. Captures system audio, transcribes
  speech in real time, and answers questions using text or screenshots.
Moniker: realtime-interview-copilot
Tags:
  - ai
  - interview
  - productivity
  - electron
ManifestType: defaultLocale
ManifestVersion: 1.6.0
`,
  );

  const latestPath = path.join(
    wingetDir,
    "packages",
    WINGET.folder,
    "LATEST",
  );
  fs.mkdirSync(path.dirname(latestPath), { recursive: true });
  fs.writeFileSync(latestPath, `${version}\n`);

  console.log(`✅ Wrote winget manifests → ${manifestDir}`);
  console.log(`   packages/${WINGET.folder}/LATEST → ${version}`);
}

const dmgFiles = fs
  .readdirSync(assetsDir)
  .filter((n) => n.endsWith("-mac-arm64.dmg") && !n.endsWith(".blockmap"));

const exeFiles = fs
  .readdirSync(assetsDir)
  .filter((n) => n.endsWith("-win-x64.exe") && !n.endsWith(".blockmap"));

if (tapDir) {
  const dmg = pickAsset(dmgFiles, refVersion, versionFromDmgFilename, "DMG");
  const expectedCi = `Realtime Interview Copilot Beta-${dmg.version}-mac-arm64.dmg`;
  const expectedRelease = `Realtime.Interview.Copilot.Beta-${dmg.version}-mac-arm64.dmg`;
  if (dmg.name !== expectedCi && dmg.name !== expectedRelease) {
    console.error(
      `❌ Unexpected DMG name ${dmg.name} (expected ${expectedCi} or ${expectedRelease})`,
    );
    process.exit(1);
  }
  writeCask(dmg.version, sha256File(path.join(assetsDir, dmg.name)));
}

if (wingetDir) {
  const exe = pickAsset(exeFiles, refVersion, versionFromExeFilename, "EXE");
  const expectedCi = `Realtime Interview Copilot Beta-${exe.version}-win-x64.exe`;
  const expectedRelease = `Realtime.Interview.Copilot.Beta-${exe.version}-win-x64.exe`;
  if (exe.name !== expectedCi && exe.name !== expectedRelease) {
    console.error(
      `❌ Unexpected EXE name ${exe.name} (expected ${expectedCi} or ${expectedRelease})`,
    );
    process.exit(1);
  }
  writeWingetManifests(exe.version, sha256File(path.join(assetsDir, exe.name)));
}
