#!/usr/bin/env node

const { spawn } = require("child_process");
const path = require("path");

// Resolve the locally-installed TypeScript compiler entry point so this works
// identically on macOS, Linux, and Windows (avoids `npx tsc` pulling the
// unrelated `tsc@2.0.4` stub package on Windows).
const tscBin = require.resolve("typescript/bin/tsc");

function runTsc(entry) {
  return new Promise((resolve, reject) => {
    const args = [
      tscBin,
      entry,
      "--outDir",
      "electron",
      "--module",
      "commonjs",
      "--target",
      "es2020",
      "--esModuleInterop",
      "--skipLibCheck",
    ];
    const child = spawn(process.execPath, args, {
      stdio: "inherit",
      cwd: path.resolve(__dirname, ".."),
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tsc exited with code ${code} for ${entry}`));
    });
  });
}

async function buildElectron() {
  console.log("🔨 Building Electron main and preload scripts...");
  try {
    await runTsc("electron/main.ts");
    await runTsc("electron/preload.ts");
    console.log("✅ Electron build completed successfully!");
  } catch (error) {
    console.error("❌ Error building Electron:", error.message || error);
    process.exit(1);
  }
}

buildElectron();
