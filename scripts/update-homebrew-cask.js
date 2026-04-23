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

const dmgName = `Realtime.Interview.Copilot.Beta-${version}-mac-arm64.dmg`;
const dmgPath = path.join(root, "release-assets", dmgName);

if (!fs.existsSync(dmgPath)) {
  console.error(`❌ DMG not found at ${dmgPath}`);
  process.exit(1);
}

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
