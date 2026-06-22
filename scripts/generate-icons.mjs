import fs from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import pngToIco from "png-to-ico";

const rootDir = process.cwd();
const assetsDir = path.join(rootDir, "assets");
const svgPath = path.join(assetsDir, "nexoagent-icon.svg");
const svgMarkup = await fs.readFile(svgPath, "utf8");

const pngSizes = [1024, 512, 256, 128, 64, 48, 32, 16];
const icoSizes = new Set([256, 128, 64, 48, 32, 16]);
const icoSources = [];

for (const size of pngSizes) {
  const renderer = new Resvg(svgMarkup, {
    fitTo: { mode: "width", value: size },
    background: "rgba(0,0,0,0)"
  });

  const pngData = renderer.render().asPng();
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
