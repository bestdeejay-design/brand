import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

// Logical size × scale. Duplicate pixel dimensions have distinct ICNS types.
export const records = [
  { type: 'icp4', logical: 16, scale: 1, size: 16 },
  { type: 'ic11', logical: 16, scale: 2, size: 32 },
  { type: 'icp5', logical: 32, scale: 1, size: 32 },
  { type: 'ic12', logical: 32, scale: 2, size: 64 },
  { type: 'ic07', logical: 128, scale: 1, size: 128 },
  { type: 'ic13', logical: 128, scale: 2, size: 256 },
  { type: 'ic08', logical: 256, scale: 1, size: 256 },
  { type: 'ic14', logical: 256, scale: 2, size: 512 },
  { type: 'ic09', logical: 512, scale: 1, size: 512 },
  { type: 'ic10', logical: 512, scale: 2, size: 1024 },
];
export function signDirectory(key = 'dajet-editor') {
  assert(['dajet-player', 'dajet-editor', 'dajet-browser', 'kiwi-cat', 'watermelon-cat', 'joer'].includes(key), 'Unknown sign key');
  return new URL(`../signs/${key}/`, import.meta.url);
}

export const plate = [21, 24, 28];
export const mark = [232, 174, 140];
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');

function attributes(text) {
  const result = {};
  const rest = text.replace(/([\w:-]+)="([^"]*)"/g, (_, key, value) => {
    assert(!Object.hasOwn(result, key), `Duplicate SVG attribute: ${key}`);
    result[key] = value;
    return '';
  });
  assert.equal(rest.trim(), '', 'Unrecognized SVG attribute syntax');
  return result;
}

export function validateSvg(svg) {
  // Intentionally narrow schema: one plate + one uninterrupted line, no defs,
  // CSS, opacity, filters, images, scripts or externally referenced content.
  const match = svg.trim().match(/^<svg\s+([^>]+)>\s*<path\s+([^>]+)\/>\s*<path\s+([^>]+)\/>\s*<\/svg>$/);
  assert(match, 'SVG must contain exactly two paths and no other elements');
  const { role, 'aria-label': label, ...canvas } = attributes(match[1]);
  assert(role === undefined || role === 'img');
  assert.deepEqual(canvas, {
    xmlns: 'http://www.w3.org/2000/svg', width: '1024', height: '1024',
    viewBox: '0 0 1024 1024',
  });
  const background = attributes(match[2]);
  assert.deepEqual(Object.keys(background).sort(), ['d', 'fill']);
  assert.equal(background.fill, '#15181C');
  // Exact plate geometry from brand/signs/dajet-player/icon.svg.
  // This fingerprint keeps the kit portable to the editor repository.
  assert.equal(createHash('sha256').update(background.d).digest('hex'),
    'e1dc3b641cd3615260daddcc126524d4653c1e3cd02001ff4c669cc1604fd39e',
    'Plate differs from the canonical 824px superellipse');
  const { d, ...style } = attributes(match[3]);
  assert.deepEqual(style, {
    fill: 'none', stroke: '#E8AE8C', 'stroke-width': '74',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  });
  assert(d && /^M/.test(d) && (d.match(/[Mm]/g) || []).length === 1,
    'Linear mark must be one continuous path');
  assert(/^[MmLlHhVvCcSsQqTtAaZz\d.,+\-\s]+$/.test(d), 'Invalid path syntax');
}

export async function renderSizes(svg) {
  validateSvg(svg);
  // ONE SVG rasterization at 4×; every record is a Lanczos3 downscale of it.
  // No per-size redrawing, stroke substitution or sharpening.
  const master = await sharp(Buffer.from(svg), { density: 288 })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(master.info.width, 4096);
  assert.equal(master.info.height, 4096);
  // The only translucent boundary is the outside of the dark plate. Resample
  // RGB on that same dark matte and alpha separately, avoiding unpremultiply
  // color noise in nearly transparent edge pixels. This is identical at ALL sizes.
  const rgb = await sharp(master.data, { raw: master.info })
    .flatten({ background: '#15181C' }).raw().toBuffer({ resolveWithObject: true });
  const alpha = await sharp(master.data, { raw: master.info })
    .extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  const sizes = new Map();
  for (const size of new Set(records.map(record => record.size))) {
    const resizedAlpha = await sharp(alpha.data, { raw: alpha.info })
      .resize(size, size, { kernel: 'lanczos3' }).toColourspace('b-w').raw().toBuffer();
    sizes.set(size, await sharp(rgb.data, { raw: rgb.info })
      .resize(size, size, { kernel: 'lanczos3' })
      .joinChannel(resizedAlpha, { raw: { width: size, height: size, channels: 1 } })
      .png({ compressionLevel: 9, palette: false }).toBuffer());
  }
  return sizes;
}

export function packIcns(sizes) {
  const chunks = records.map(({ type, size }) => {
    const png = sizes.get(size);
    assert(png, `Missing render: ${size}`);
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(8 + png.length, 4);
    return Buffer.concat([header, png]);
  });
  const header = Buffer.alloc(8);
  header.write('icns');
  header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

export function unpackIcns(buffer) {
  assert(buffer.length >= 8, 'Truncated ICNS header');
  assert.equal(buffer.toString('ascii', 0, 4), 'icns', 'Invalid ICNS signature');
  assert.equal(buffer.readUInt32BE(4), buffer.length, 'Invalid ICNS file length');
  const entries = new Map();
  for (let offset = 8; offset < buffer.length;) {
    assert(offset + 8 <= buffer.length, 'Truncated record header');
    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32BE(offset + 4);
    assert(length > 8 && offset + length <= buffer.length, `Invalid length: ${type}`);
    assert(records.some(record => record.type === type), `Unexpected record: ${type}`);
    assert(!entries.has(type), `Duplicate record: ${type}`);
    const png = buffer.subarray(offset + 8, offset + length);
    assert(png.subarray(0, 8).equals(pngSignature), `Non-PNG record: ${type}`);
    entries.set(type, png);
    offset += length;
  }
  assert.equal(entries.size, 10, 'ICNS must have exactly ten records');
  for (const { type } of records) assert(entries.has(type), `Missing record: ${type}`);
  return entries;
}

export async function decodePng(png, size) {
  const metadata = await sharp(png, { limitInputPixels: 1024 * 1024 }).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, size, 'Incorrect record width');
  assert.equal(metadata.height, size, 'Incorrect record height');
  return sharp(png).toColourspace('srgb').ensureAlpha().raw().toBuffer();
}

export function pixelStats(rgba) {
  const result = { plate: 0, mark: 0, exactPlate: 0, exactMark: 0, pixels: rgba.length / 4 };
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 240) continue;
    for (const [name, color] of [['plate', plate], ['mark', mark]]) {
      const distance2 = color.reduce((sum, value, channel) => sum + (rgba[i + channel] - value) ** 2, 0);
      // Tolerance handles anti-aliasing without counting ambiguous mixed pixels.
      if (distance2 <= 48 ** 2) result[name]++;
      if (distance2 === 0 && rgba[i + 3] === 255) {
        result[name === 'plate' ? 'exactPlate' : 'exactMark']++;
      }
    }
  }
  return result;
}

export function assertVisible(stats, type) {
  assert(stats.plate / stats.pixels >= 0.20, `${type}: missing/insufficient plate pixels`);
  assert(stats.mark / stats.pixels >= 0.005, `${type}: missing/insufficient mark pixels`);
}
