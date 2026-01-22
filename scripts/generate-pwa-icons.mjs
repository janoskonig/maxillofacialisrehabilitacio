import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const src = "public/logo.svg";
const outDir = "public";

await mkdir(outDir, { recursive: true });

const jobs = [
  { file: "icon-192x192.png", size: 192 },
  { file: "icon-512x512.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180 }
];

for (const j of jobs) {
  await sharp(src)
    .resize(j.size, j.size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(`${outDir}/${j.file}`);
}

console.log("PWA icons generated.");
