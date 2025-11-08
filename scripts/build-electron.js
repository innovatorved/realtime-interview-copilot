#!/usr/bin/env node

const { exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");

const execAsync = promisify(exec);

async function buildElectron() {
  console.log("🔨 Building Electron main and preload scripts...");

  try {
    // Compile TypeScript files
    await execAsync(
      "npx tsc electron/main.ts --outDir electron --module commonjs --target es2020 --esModuleInterop --skipLibCheck",
    );
    await execAsync(
      "npx tsc electron/preload.ts --outDir electron --module commonjs --target es2020 --esModuleInterop --skipLibCheck",
    );

    console.log("✅ Electron build completed successfully!");
  } catch (error) {
    console.error("❌ Error building Electron:", error);
    process.exit(1);
  }
}

buildElectron();
