#!/usr/bin/env node

// Reads constant.json → updates package.json build.productName,
// pins artifactName for stable download filenames, and rewrites macOS
// permission strings to use displayName.

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pkgPath = path.join(root, "package.json");
const constantsPath = path.join(root, "constant.json");

const constants = JSON.parse(fs.readFileSync(constantsPath, "utf8"));
const displayName =
  typeof constants.displayName === "string" && constants.displayName.length > 0
    ? constants.displayName
    : "Meeting Copilot";

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
if (!pkg.build) pkg.build = {};

pkg.build.productName = displayName;
// Keep legacy download filenames (spaces) so CI sync + Homebrew/WinGet URLs stay
// compatible with v0.14.x releases. productName alone controls the bundled .app name.
pkg.build.artifactName =
  "Realtime Interview Copilot Beta-${version}-${os}-${arch}.${ext}";

if (pkg.build.mac?.extendInfo) {
  const info = pkg.build.mac.extendInfo;
  if (typeof info.NSMicrophoneUsageDescription === "string") {
    info.NSMicrophoneUsageDescription = `${displayName} uses the microphone to transcribe your voice for the Ask AI feature.`;
  }
  if (typeof info.NSCameraUsageDescription === "string") {
    info.NSCameraUsageDescription = `${displayName} does not record from the camera; this permission is requested only by macOS for media capture APIs and will not be used.`;
  }
  if (typeof info.NSAppleEventsUsageDescription === "string") {
    info.NSAppleEventsUsageDescription = `${displayName} does not script other apps; this permission is requested only by macOS for system integration.`;
  }
}

fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(
  `Applied displayName "${displayName}" to package.json build config.`,
);
