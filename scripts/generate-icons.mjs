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

const faviconSizes = [16, 32, 48];

async function generateIconPngs() {
  for (const { width, name } of pngSizes) {
    const buffer = await sharp(iconSvg).resize(width, width).png().toBuffer();
    writeFileSync(resolve(publicDir, name), buffer);
    console.log(`  ${name} (${width}x${width})`);
  }
}

function buildIco(pngEntries) {
  const headerSize = 6;
  const directoryEntrySize = 16;
  const directorySize = pngEntries.length * directoryEntrySize;
  const imageBytes = pngEntries.reduce((total, entry) => total + entry.buffer.length, 0);
  const icoBuffer = Buffer.alloc(headerSize + directorySize + imageBytes);

  icoBuffer.writeUInt16LE(0, 0);
  icoBuffer.writeUInt16LE(1, 2);
  icoBuffer.writeUInt16LE(pngEntries.length, 4);

  let imageOffset = headerSize + directorySize;

  pngEntries.forEach(({ width, buffer }, index) => {
    const entryOffset = headerSize + index * directoryEntrySize;

    icoBuffer.writeUInt8(width >= 256 ? 0 : width, entryOffset);
    icoBuffer.writeUInt8(width >= 256 ? 0 : width, entryOffset + 1);
    icoBuffer.writeUInt8(0, entryOffset + 2);
    icoBuffer.writeUInt8(0, entryOffset + 3);
    icoBuffer.writeUInt16LE(1, entryOffset + 4);
    icoBuffer.writeUInt16LE(32, entryOffset + 6);
    icoBuffer.writeUInt32LE(buffer.length, entryOffset + 8);
    icoBuffer.writeUInt32LE(imageOffset, entryOffset + 12);

    buffer.copy(icoBuffer, imageOffset);
    imageOffset += buffer.length;
  });

  return icoBuffer;
}

const splashScreens = [
  { width: 640, height: 1136, scale: "2x", device: "iPhone SE" },
  { width: 1170, height: 2532, scale: "3x", device: "iPhone 14" },
  { width: 1179, height: 2556, scale: "3x", device: "iPhone 14 Pro / 15 / 16" },
  { width: 1290, height: 2796, scale: "3x", device: "iPhone 15/16 Pro Max" },
];

async function generateSplashScreens() {
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
  const pngEntries = await Promise.all(
    faviconSizes.map(async (width) => ({
      width,
      buffer: await sharp(iconSvg).resize(width, width).png().toBuffer(),
    })),
  );
  const favicon = buildIco(pngEntries);
  const faviconLabels = faviconSizes.map((size) => `${size}x${size}`).join(", ");

  writeFileSync(resolve(rootDir, "src/app/favicon.ico"), favicon);
  console.log(`  favicon.ico (${faviconLabels})`);
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
