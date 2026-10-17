import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { renderSizes, packIcns, unpackIcns, signDirectory } from './icon-lib.mjs';

const key = process.argv[2] || 'dajet-editor';
const directory = signDirectory(key);
const source = new URL('icon.svg', directory);
const output = process.argv[3] ? resolve(process.argv[3]) : fileURLToPath(directory);
const previews = resolve(output, 'previews');
await mkdir(previews, { recursive: true });
const sizes = await renderSizes(await readFile(source, 'utf8'));
const icns = packIcns(sizes);
await writeFile(resolve(output, 'AppIcon.icns'), icns);

// Evidence is extracted from the packed artifact, not a separate SVG preview.
const entries = unpackIcns(icns);
for (const [size, type] of [[16, 'icp4'], [32, 'icp5'], [128, 'ic07'], [1024, 'ic10']]) {
  await writeFile(resolve(size === 1024 ? output : previews, `icon-${size}.png`), entries.get(type));
}
for (const [size, type] of [[16, 'icp4'], [32, 'icp5']]) {
  await sharp(entries.get(type)).resize(512, 512, { kernel: 'nearest' })
    .png().toFile(resolve(output, `preview-${size}.png`));
}
// Review sheet only: the light presentation background is NOT an icon color.
const sheet = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="850">
  <rect width="1400" height="850" fill="#F2EFE9"/>
  <g font-family="sans-serif" fill="#15181C">
    <text x="64" y="72" font-size="18" letter-spacing="4">${key.toUpperCase().replaceAll('-', ' / ')}</text>
    <text x="64" y="132" font-size="42">${key === 'dajet-editor' ? 'One line. A pair of headphones.' : 'One line. One canonical sign.'}</text>
    <text x="690" y="208" font-size="16">NATIVE PIXELS</text>
    <text x="690" y="374" font-size="16">16 px</text>
    <text x="790" y="374" font-size="16">32 px</text>
    <text x="932" y="374" font-size="16">128 px</text>
    <text x="690" y="746" font-size="16">16 px / nearest-neighbor ×16</text>
    <text x="1010" y="746" font-size="16">32 px / nearest-neighbor ×8</text>
    <text x="64" y="770" font-size="18">#15181C + #E8AE8C · Stroke 74</text>
    <text x="64" y="806" font-size="16">1024 canvas · 824 plate · Original player plate geometry</text>
  </g>
</svg>`);
const onMatte = async (png, size, kernel = 'lanczos3') => sharp(png)
  .resize(size, size, { kernel }).flatten({ background: '#F2EFE9' }).png().toBuffer();
await sharp(sheet).composite([
  { input: await onMatte(entries.get('ic10'), 560), left: 40, top: 172 },
  { input: await onMatte(entries.get('icp4'), 16), left: 700, top: 280 },
  { input: await onMatte(entries.get('icp5'), 32), left: 800, top: 272 },
  { input: await onMatte(entries.get('ic07'), 128), left: 920, top: 224 },
  { input: await onMatte(entries.get('icp4'), 256, 'nearest'), left: 690, top: 432 },
  { input: await onMatte(entries.get('icp5'), 256, 'nearest'), left: 1010, top: 432 },
]).png().toFile(resolve(previews, 'review.png'));
console.log(`Built ${resolve(output, 'AppIcon.icns')} (${icns.length} bytes, 10 records)`);
console.log(`Extracted preview frames: ${previews}`);
