#!/usr/bin/env node

// Regenerates homebrew/Casks/realtime-interview-copilot.rb with the version
// from package.json and the SHA256 of the already-downloaded DMG under
// ./release-assets/ (populated by the CI release job).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const version = pkg.version;

const assetsDir = path.join(root, "release-assets");
if (!fs.existsSync(assetsDir)) {
  console.error(`❌ release-assets directory not found at ${assetsDir}`);
  process.exit(1);
}

// electron-builder names the DMG from productName ("Realtime Interview Copilot
// Beta"), which yields a file with spaces, e.g.
//   "Realtime Interview Copilot Beta-0.4.2-beta-mac-arm64.dmg"
// The artifactName template in package.json may also replace spaces with dots
// on some platforms, so match both shapes by looking for any arm64 DMG that
// carries the current version.
const candidates = fs
  .readdirSync(assetsDir)
  .filter(
    (name) =>
      name.endsWith("-mac-arm64.dmg") &&
      name.includes(`-${version}-`) &&
      !name.endsWith(".blockmap"),
  );

if (candidates.length === 0) {
  console.error(
    `❌ No arm64 DMG for version ${version} found in ${assetsDir}. Contents:\n` +
      fs
        .readdirSync(assetsDir)
        .map((n) => `  - ${n}`)
        .join("\n"),
  );
  process.exit(1);
}

const dmgName = candidates[0];
const dmgPath = path.join(assetsDir, dmgName);
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
contents = contents.replace(/version "[^"]+"/, `version "${version}"`);
contents = contents.replace(/sha256 "[^"]+"/, `sha256 "${sha256}"`);
fs.writeFileSync(caskPath, contents);

console.log(`✅ Updated cask → version=${version} sha256=${sha256}`);
