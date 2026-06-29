import fs from "node:fs/promises";
import path from "node:path";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const rootDir = process.cwd();
const assetsDir = path.join(rootDir, "assets");
const sourcePath = path.join(assetsDir, "nexoagent-logo-source.png");

const pngSizes = [1024, 512, 256, 128, 64, 48, 32, 16];
const icoSizes = new Set([256, 128, 64, 48, 32, 16]);
const icoSources = [];
const crop = { left: 202, top: 0, width: 850, height: 850 };

for (const size of pngSizes) {
  const pngData = await sharp(sourcePath)
    .extract(crop)
    .resize(size, size, { fit: "contain" })
    .png()
    .toBuffer();
  const outputPath = path.join(assetsDir, `nexoagent-icon-${size}.png`);
  await fs.writeFile(outputPath, pngData);
  console.log(`wrote ${path.relative(rootDir, outputPath)}`);

  if (icoSizes.has(size)) {
    icoSources.push(pngData);
  }
}

await fs.copyFile(path.join(assetsDir, "nexoagent-icon-512.png"), path.join(assetsDir, "nexoagent-icon.png"));
console.log("wrote assets/nexoagent-icon.png");

const icoData = await pngToIco(icoSources);
await fs.writeFile(path.join(assetsDir, "nexoagent-icon.ico"), icoData);
console.log("wrote assets/nexoagent-icon.ico");
