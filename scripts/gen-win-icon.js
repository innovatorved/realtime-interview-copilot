#!/usr/bin/env node

// Generate a multi-size favicon.ico (including 256x256) for electron-builder's
// Windows target, which requires the icon to contain at least one 256x256
// image.

const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const pngToIco = require("png-to-ico").default;

const SOURCE = path.resolve(
  __dirname,
  "..",
  "public",
  "icons",
  "android-chrome-512x512.png",
);
const OUT = path.resolve(__dirname, "..", "public", "icons", "favicon.ico");
const SIZES = [16, 32, 48, 64, 128, 256];

async function main() {
  const buffers = await Promise.all(
    SIZES.map((size) =>
      sharp(SOURCE).resize(size, size, { fit: "contain" }).png().toBuffer(),
    ),
  );
  const ico = await pngToIco(buffers);
  fs.writeFileSync(OUT, ico);
  console.log(`✅ Wrote ${OUT} with sizes ${SIZES.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
