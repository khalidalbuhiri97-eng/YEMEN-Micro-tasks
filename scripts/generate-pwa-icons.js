import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';

/**
 * Builds a valid binary .ico container wrapping one or more PNG buffers.
 * Modern browsers and Windows ICO decoders natively support PNG-encoded entries inside ICO.
 */
function buildIcoFromPngBuffers(entries) {
  const count = entries.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // Reserved = 0
  header.writeUInt16LE(1, 2); // Type = 1 (ICO)
  header.writeUInt16LE(count, 4); // Image count

  const dirBuffers = [];
  let offset = headerSize + count * dirEntrySize;

  for (const { width, height, buffer } of entries) {
    const dir = Buffer.alloc(dirEntrySize);
    dir.writeUInt8(width >= 256 ? 0 : width, 0); // Width (0 means 256)
    dir.writeUInt8(height >= 256 ? 0 : height, 1); // Height
    dir.writeUInt8(0, 2); // Color palette count (0 for >= 8bpp)
    dir.writeUInt8(0, 3); // Reserved
    dir.writeUInt16LE(1, 4); // Color planes
    dir.writeUInt16LE(32, 6); // Bits per pixel
    dir.writeUInt32LE(buffer.length, 8); // Size of PNG data
    dir.writeUInt32LE(offset, 12); // Offset from start of file
    dirBuffers.push(dir);
    offset += buffer.length;
  }

  return Buffer.concat([header, ...dirBuffers, ...entries.map((e) => e.buffer)]);
}

async function generateIcons() {
  const sourcePath = path.resolve(
    'public/assets/aistudio/file_00000000170c81faa7ae4d63a4bf7eb1_6d20e095.png'
  );
  const pubDir = path.resolve('public');

  if (!(await fs.stat(sourcePath).catch(() => false))) {
    console.error('Official Yemen Task icon source not found at:', sourcePath);
    process.exit(1);
  }

  console.log('Generating official Yemen Task PWA icons from:', sourcePath);

  // Use source as-is (trimmed slightly of outer white edge artifacts if any, transparent corners kept clean or emerald filled)
  const baseInput = sharp(sourcePath).ensureAlpha();

  // 1. 192x192 PWA standard icon
  await baseInput
    .clone()
    .resize(192, 192, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(pubDir, 'pwa-192x192.png'));
  console.log('✓ Generated pwa-192x192.png (192x192)');

  // 2. 512x512 PWA splash & install icon
  await baseInput
    .clone()
    .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(pubDir, 'pwa-512x512.png'));
  console.log('✓ Generated pwa-512x512.png (512x512)');

  // 3. Maskable 512x512 icon (safe zone inner 78% centered on matching deep emerald backdrop)
  const innerSize = Math.round(512 * 0.78);
  const resizedInner = await baseInput
    .clone()
    .resize(innerSize, innerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 6, g: 95, b: 70, alpha: 1 }, // #065f46 deep emerald matching official emblem
    },
  })
    .composite([{ input: resizedInner, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(pubDir, 'pwa-maskable-512x512.png'));
  console.log('✓ Generated pwa-maskable-512x512.png (512x512 maskable safe zone)');

  // 4. Apple Touch Icon 180x180 (opaque background recommended by iOS)
  const appleInnerSize = 160;
  const appleInner = await baseInput
    .clone()
    .resize(appleInnerSize, appleInnerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 180,
      height: 180,
      channels: 4,
      background: { r: 6, g: 95, b: 70, alpha: 1 },
    },
  })
    .composite([{ input: appleInner, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(pubDir, 'apple-touch-icon.png'));
  console.log('✓ Generated apple-touch-icon.png (180x180)');

  // 5. In-app high-res brand icon 128x128 for Navbar, Sidebar, Drawer, Cards
  await baseInput
    .clone()
    .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(pubDir, 'brand-icon.png'));
  console.log('✓ Generated brand-icon.png (128x128)');

  // 6. Favicon 32x32 PNG
  const png32 = await baseInput
    .clone()
    .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await fs.writeFile(path.join(pubDir, 'favicon.png'), png32);
  console.log('✓ Generated favicon.png (32x32)');

  // 7. Valid Multi-Entry Binary favicon.ico (16x16 + 32x32 PNG entries)
  const png16 = await baseInput
    .clone()
    .resize(16, 16, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const icoBuffer = buildIcoFromPngBuffers([
    { width: 16, height: 16, buffer: png16 },
    { width: 32, height: 32, buffer: png32 },
  ]);
  await fs.writeFile(path.join(pubDir, 'favicon.ico'), icoBuffer);
  console.log('✓ Generated valid binary favicon.ico (16x16 + 32x32)');
}

generateIcons().catch((err) => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
