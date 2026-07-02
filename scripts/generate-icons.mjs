import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const publicDir = resolve(rootDir, "public");

const iconSvgPath = resolve(publicDir, "icon.svg");
const iconSvg = readFileSync(iconSvgPath);

const pngSizes = [
  { width: 72, name: "icon-72.png" },
  { width: 96, name: "icon-96.png" },
  { width: 128, name: "icon-128.png" },
  { width: 144, name: "icon-144.png" },
  { width: 152, name: "icon-152.png" },
  { width: 180, name: "apple-touch-icon.png" },
  { width: 192, name: "icon-192.png" },
  { width: 384, name: "icon-384.png" },
  { width: 512, name: "icon-512.png" },
];

async function generateIconPngs() {
  for (const { width, name } of pngSizes) {
    const buffer = await sharp(iconSvg).resize(width, width).png().toBuffer();
    writeFileSync(resolve(publicDir, name), buffer);
    console.log(`  ${name} (${width}x${width})`);
  }
}

const splashScreens = [
  { width: 640, height: 1136, scale: "2x", device: "iPhone SE" },
  { width: 1170, height: 2532, scale: "3x", device: "iPhone 14" },
  { width: 1179, height: 2556, scale: "3x", device: "iPhone 14 Pro / 15 / 16" },
  { width: 1290, height: 2796, scale: "3x", device: "iPhone 15/16 Pro Max" },
];

async function generateSplashScreens() {
  const icon512 = await sharp(iconSvg).resize(512, 512).png().toBuffer();

  for (const { width, height, device } of splashScreens) {
    const iconSize = Math.round(width * 0.22);
    const iconBuffer = await sharp(iconSvg)
      .resize(iconSize, iconSize)
      .png()
      .toBuffer();

    const bgSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse">
      <stop stop-color="#14B8A6"/>
      <stop offset="1" stop-color="#2563EB"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
</svg>`;

    const bgBuffer = await sharp(Buffer.from(bgSvg))
      .resize(width, height)
      .png()
      .toBuffer();

    const iconLeft = Math.round((width - iconSize) / 2);
    const iconTop = Math.round((height - iconSize) / 2);

    const splashBuffer = await sharp(bgBuffer)
      .composite([
        { input: iconBuffer, left: iconLeft, top: iconTop },
      ])
      .png()
      .toBuffer();

    const name = `splash-${width}x${height}.png`;
    writeFileSync(resolve(publicDir, name), splashBuffer);
    console.log(`  ${name} (${width}x${height}) — ${device}`);
  }
}

async function generateFavicon() {
  const favicon32 = await sharp(iconSvg).resize(32, 32).png().toBuffer();
  writeFileSync(resolve(rootDir, "src/app/favicon.ico"), favicon32);
  console.log(`  favicon.ico (32x32)`);
}

async function main() {
  console.log("Generating PWA icons...");
  await generateIconPngs();
  console.log("Generating splash screens...");
  await generateSplashScreens();
  console.log("Generating favicon...");
  await generateFavicon();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
