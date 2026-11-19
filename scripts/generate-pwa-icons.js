import sharp from 'path'; // wait, sharp is imported from 'sharp'
import { promises as fs } from 'fs';
import path from 'path';
import sharpLib from 'sharp';

async function generateIcons() {
  const sourcePath = path.resolve('public/assets/aistudio/file_00000000c20081fab7dec83252f24e1e_4ccc727f.png');
  const pubDir = path.resolve('public');

  if (!await fs.stat(sourcePath).catch(() => false)) {
    console.error('Source icon not found at:', sourcePath);
    process.exit(1);
  }

  console.log('Generating PWA icons using sharp from:', sourcePath);

  // 1. 192x192
  await sharpLib(sourcePath)
    .resize(192, 192, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(path.join(pubDir, 'pwa-192x192.png'));
  console.log('✓ Generated pwa-192x192.png');

  // 2. 512x512
  await sharpLib(sourcePath)
    .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(path.join(pubDir, 'pwa-512x512.png'));
  console.log('✓ Generated pwa-512x512.png');

  // 3. Maskable 512x512 (with 15% padding for safe area)
  const innerSize = Math.round(512 * 0.8);
  const resizedInner = await sharpLib(sourcePath)
    .resize(innerSize, innerSize, { fit: 'contain' })
    .toBuffer();

  await sharpLib({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 30, g: 64, b: 175, alpha: 1 }, // Blue-800 background
    },
  })
    .composite([{ input: resizedInner, gravity: 'center' }])
    .png()
    .toFile(path.join(pubDir, 'pwa-maskable-512x512.png'));
  console.log('✓ Generated pwa-maskable-512x512.png');

  // 4. Apple Touch Icon 180x180
  await sharpLib(sourcePath)
    .resize(180, 180, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(path.join(pubDir, 'apple-touch-icon.png'));
  console.log('✓ Generated apple-touch-icon.png');

  // 5. Favicon 48x48
  await sharpLib(sourcePath)
    .resize(48, 48, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(path.join(pubDir, 'favicon.png'));
  
  await sharpLib(sourcePath)
    .resize(32, 32, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .toFile(path.join(pubDir, 'favicon.ico'));
  console.log('✓ Generated favicon.ico & favicon.png');
}

generateIcons().catch((err) => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
