#!/usr/bin/env node

// Regenerates winget/manifests/i/Innovatorved/RealtimeInterviewCopilot/<version>/:
// - PackageVersion, InstallerUrl, InstallerSha256 from the x64 NSIS .exe in release-assets/
// - EXE basename must follow package.json build.artifactName (URL-safe dots):
//     Realtime.Interview.Copilot.Beta-<semver>-win-x64.exe
// - RELEASE_TAG (e.g. v0.14.0-beta) must match the semver inside that filename
//   (after stripping "v"). Otherwise CI fails — bump package.json before tagging.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const pkgVersion = pkg.version;

const GITHUB_OWNER = "innovatorved";
const GITHUB_REPO = "realtime-interview-copilot";
const PACKAGE_ID = "Innovatorved.RealtimeInterviewCopilot";
const PACKAGE_FOLDER = "RealtimeInterviewCopilot";

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

if (refName) {
  console.log(`→ Release ref: ${refName} (expects EXE semver: ${refVersion})`);
}

const assetsDir = path.join(root, "release-assets");
if (!fs.existsSync(assetsDir)) {
  console.error(`❌ release-assets directory not found at ${assetsDir}`);
  process.exit(1);
}

/** Semver before -win-x64.exe (matches build.artifactName, dots not spaces). */
function versionFromExeFilename(name) {
  const m = name.match(
    /^Realtime\.Interview\.Copilot\.Beta-(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)-win-x64\.exe$/i,
  );
  return m ? m[1] : null;
}

function installerUrl(version) {
  const file = `Realtime.Interview.Copilot.Beta-${version}-win-x64.exe`;
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${version}/${file}`;
}

function writeManifests(version, sha256) {
  const manifestDir = path.join(
    root,
    "winget",
    "manifests",
    "i",
    "Innovatorved",
    "RealtimeInterviewCopilot",
    version,
  );
  fs.mkdirSync(manifestDir, { recursive: true });

  const versionYaml = `# Synced to github.com/${GITHUB_OWNER}/winget by CI.
# scripts/update-winget-manifest.js rewrites version, url, and sha256 fields.
PackageIdentifier: ${PACKAGE_ID}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.6.0
`;

  const installerYaml = `# Synced to github.com/${GITHUB_OWNER}/winget by CI.
PackageIdentifier: ${PACKAGE_ID}
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
      - DisplayName: Realtime Interview Copilot Beta
        Publisher: Innovatorved
ManifestType: installer
ManifestVersion: 1.6.0
`;

  const localeYaml = `# Synced to github.com/${GITHUB_OWNER}/winget by CI.
PackageIdentifier: ${PACKAGE_ID}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: Innovatorved
PublisherUrl: https://github.com/${GITHUB_OWNER}
PublisherSupportUrl: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/issues
PackageName: Realtime Interview Copilot Beta
PackageUrl: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}
License: Apache-2.0
LicenseUrl: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/blob/main/LICENSE
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
`;

  fs.writeFileSync(path.join(manifestDir, `${PACKAGE_ID}.yaml`), versionYaml);
  fs.writeFileSync(
    path.join(manifestDir, `${PACKAGE_ID}.installer.yaml`),
    installerYaml,
  );
  fs.writeFileSync(
    path.join(manifestDir, `${PACKAGE_ID}.locale.en-US.yaml`),
    localeYaml,
  );

  const latestPath = path.join(
    root,
    "winget",
    "packages",
    PACKAGE_FOLDER,
    "LATEST",
  );
  fs.mkdirSync(path.dirname(latestPath), { recursive: true });
  fs.writeFileSync(latestPath, `${version}\n`);

  console.log(`✅ Wrote manifests → ${manifestDir}`);
  console.log(`   InstallerUrl: ${installerUrl(version)}`);
  console.log(`   InstallerSha256: ${sha256}`);
  console.log(`   packages/${PACKAGE_FOLDER}/LATEST → ${version}`);
}

const winExes = fs
  .readdirSync(assetsDir)
  .filter(
    (name) => name.endsWith("-win-x64.exe") && !name.endsWith(".blockmap"),
  )
  .map((name) => ({
    name,
    version: versionFromExeFilename(name),
  }))
  .filter((x) => x.version !== null);

if (winExes.length === 0) {
  console.error(
    `❌ No x64 EXE matching Realtime.Interview.Copilot.Beta-<ver>-win-x64.exe in ${assetsDir}.\n` +
      `   Set build.artifactName in package.json and rebuild. Contents:\n` +
      fs
        .readdirSync(assetsDir)
        .map((n) => `  - ${n}`)
        .join("\n"),
  );
  process.exit(1);
}

let chosen = null;

if (refVersion) {
  const byTag = winExes.filter((x) => x.version === refVersion);
  if (byTag.length === 1) {
    chosen = byTag[0];
  } else if (byTag.length > 1) {
    chosen = byTag[0];
    console.warn(
      `⚠️ Multiple EXEs matched tag ${refVersion}; using ${chosen.name}`,
    );
  } else {
    console.error(
      `❌ RELEASE_TAG is ${refName} (semver ${refVersion}) but no EXE has that version in its filename.\n` +
        `   Bump "version" in package.json before building, then retag / rebuild. Found:\n` +
        winExes.map((x) => `  - ${x.name}`).join("\n"),
    );
    process.exit(1);
  }
}

if (!chosen) {
  const byPkg = winExes.filter((x) => x.version === pkgVersion);
  if (byPkg.length === 1) {
    chosen = byPkg[0];
  } else if (byPkg.length > 1) {
    chosen = byPkg[0];
    console.warn(
      `⚠️ Multiple EXEs matched package.json ${pkgVersion}; using ${chosen.name}`,
    );
  }
}

if (!chosen) {
  if (winExes.length === 1) {
    chosen = winExes[0];
    console.warn(
      `⚠️ Using sole EXE ${chosen.name} (set RELEASE_TAG in CI to enforce tag ↔ EXE semver).`,
    );
  }
}

if (!chosen) {
  console.error(
    `❌ Could not pick one x64 EXE. tag=${refVersion ?? "none"} package=${pkgVersion}\n` +
      winExes.map((x) => `  - ${x.name} → ${x.version}`).join("\n"),
  );
  process.exit(1);
}

const { name: exeName, version } = chosen;
const exePath = path.join(assetsDir, exeName);

if (refVersion && refVersion !== version) {
  console.error(
    `❌ Internal error: chosen EXE semver ${version} !== ref ${refVersion}`,
  );
  process.exit(1);
}

if (pkgVersion !== version) {
  console.warn(
    `⚠️ package.json version (${pkgVersion}) ≠ EXE semver (${version}). Prefer keeping them equal before release.`,
  );
}

const expectedBase = `Realtime.Interview.Copilot.Beta-${version}-win-x64.exe`;
if (exeName !== expectedBase) {
  console.error(`❌ Unexpected EXE name ${exeName} (expected ${expectedBase})`);
  process.exit(1);
}

console.log(`→ Using EXE: ${exeName}`);

const sha256 = crypto
  .createHash("sha256")
  .update(fs.readFileSync(exePath))
  .digest("hex");

writeManifests(version, sha256);
