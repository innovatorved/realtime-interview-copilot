#!/usr/bin/env node

// Regenerates homebrew/Casks/realtime-interview-copilot.rb:
// - `version` + `sha256` from the arm64 DMG in release-assets/
// - DMG basename must follow package.json build.artifactName:
//     Realtime Interview Copilot Beta-<semver>-mac-arm64.dmg
// - RELEASE_TAG (e.g. v0.7.0-beta) must match the semver inside that filename
//   (after stripping "v"). Otherwise CI fails — bump package.json before tagging.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const pkgVersion = pkg.version;

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
  console.log(`→ Release ref: ${refName} (expects DMG semver: ${refVersion})`);
}

const assetsDir = path.join(root, "release-assets");
if (!fs.existsSync(assetsDir)) {
  console.error(`❌ release-assets directory not found at ${assetsDir}`);
  process.exit(1);
}

/** Semver before -mac-arm64.dmg (matches build.artifactName). */
function versionFromDmgFilename(name) {
  const m = name.match(
    /^Realtime Interview Copilot Beta-(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)-mac-arm64\.dmg$/i,
  );
  return m ? m[1] : null;
}

const arm64Dmgs = fs
  .readdirSync(assetsDir)
  .filter(
    (name) => name.endsWith("-mac-arm64.dmg") && !name.endsWith(".blockmap"),
  )
  .map((name) => ({
    name,
    version: versionFromDmgFilename(name),
  }))
  .filter((x) => x.version !== null);

if (arm64Dmgs.length === 0) {
  console.error(
    `❌ No arm64 DMG matching Realtime Interview Copilot Beta-<ver>-mac-arm64.dmg in ${assetsDir}.\n` +
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
  const byTag = arm64Dmgs.filter((x) => x.version === refVersion);
  if (byTag.length === 1) {
    chosen = byTag[0];
  } else if (byTag.length > 1) {
    chosen = byTag[0];
    console.warn(
      `⚠️ Multiple DMGs matched tag ${refVersion}; using ${chosen.name}`,
    );
  } else {
    console.error(
      `❌ RELEASE_TAG is ${refName} (semver ${refVersion}) but no DMG has that version in its filename.\n` +
        `   Bump "version" in package.json before building, then retag / rebuild. Found:\n` +
        arm64Dmgs.map((x) => `  - ${x.name}`).join("\n"),
    );
    process.exit(1);
  }
}

if (!chosen) {
  const byPkg = arm64Dmgs.filter((x) => x.version === pkgVersion);
  if (byPkg.length === 1) {
    chosen = byPkg[0];
  } else if (byPkg.length > 1) {
    chosen = byPkg[0];
    console.warn(
      `⚠️ Multiple DMGs matched package.json ${pkgVersion}; using ${chosen.name}`,
    );
  }
}

if (!chosen) {
  if (arm64Dmgs.length === 1) {
    chosen = arm64Dmgs[0];
    console.warn(
      `⚠️ Using sole DMG ${chosen.name} (set RELEASE_TAG in CI to enforce tag ↔ DMG semver).`,
    );
  }
}

if (!chosen) {
  console.error(
    `❌ Could not pick one arm64 DMG. tag=${refVersion ?? "none"} package=${pkgVersion}\n` +
      arm64Dmgs.map((x) => `  - ${x.name} → ${x.version}`).join("\n"),
  );
  process.exit(1);
}

const { name: dmgName, version } = chosen;
const dmgPath = path.join(assetsDir, dmgName);

if (refVersion && refVersion !== version) {
  console.error(
    `❌ Internal error: chosen DMG semver ${version} !== ref ${refVersion}`,
  );
  process.exit(1);
}

if (pkgVersion !== version) {
  console.warn(
    `⚠️ package.json version (${pkgVersion}) ≠ DMG semver (${version}). Prefer keeping them equal before release.`,
  );
}

const expectedBase = `Realtime Interview Copilot Beta-${version}-mac-arm64.dmg`;
if (dmgName !== expectedBase) {
  console.error(`❌ Unexpected DMG name ${dmgName} (expected ${expectedBase})`);
  process.exit(1);
}

console.log(`→ Using DMG: ${dmgName}`);

const sha256 = crypto
  .createHash("sha256")
  .update(fs.readFileSync(dmgPath))
  .digest("hex");

const caskPath = path.join(
  root,
  "homebrew",
  "Casks",
  "realtime-interview-copilot.rb",
);
let contents = fs.readFileSync(caskPath, "utf8");

if (!/^\s*version\s+"/m.test(contents)) {
  console.error(`❌ Cask has no recognizable version stanza`, caskPath);
  process.exit(1);
}
if (!/^\s*sha256\s+"/m.test(contents)) {
  console.error(`❌ Cask has no recognizable sha256 stanza`, caskPath);
  process.exit(1);
}

contents = contents.replace(/^\s*version\s+"[^"]*"/m, `  version "${version}"`);
contents = contents.replace(/^\s*sha256\s+"[^"]*"/m, `  sha256 "${sha256}"`);
fs.writeFileSync(caskPath, contents);

console.log(`✅ Updated cask → version=${version} sha256=${sha256}`);
console.log(
  `   URL is derived in Ruby as: .../releases/download/v#{version}/Realtime.Interview.Copilot.Beta-#{version}-mac-arm64.dmg`,
);
