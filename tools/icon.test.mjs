import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import {
  records, validateSvg, unpackIcns, packIcns, decodePng, pixelStats, assertVisible,
} from './icon-lib.mjs';

const svg = await readFile(new URL('../signs/dajet-editor/icon.svg', import.meta.url), 'utf8');
const icns = await readFile(new URL('../signs/dajet-editor/AppIcon.icns', import.meta.url));
const entries = unpackIcns(icns);

function container(chunks) {
  const header = Buffer.alloc(8);
  header.write('icns');
  header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}
function record(type, png) {
  const header = Buffer.alloc(8);
  header.write(type);
  header.writeUInt32BE(8 + png.length, 4);
  return Buffer.concat([header, png]);
}
const chunks = [...entries].map(([type, png]) => record(type, png));

// These tests concern ONLY new icon tooling, not the editor's Swift tests.
test('SVG satisfies the narrow canonical schema', () => validateSvg(svg));
for (const [name, badSvg] of [
  ['third color', svg.replace('#E8AE8C', '#FFFFFF')],
  ['wrong stroke', svg.replace('stroke-width="74"', 'stroke-width="96"')],
  ['square caps', svg.replace('stroke-linecap="round"', 'stroke-linecap="butt"')],
  ['opacity', svg.replace('stroke-width="74"', 'stroke-width="74" opacity="0.5"')],
  ['defs', svg.replace('</svg>', '<defs/></svg>')],
  ['extra path', svg.replace('</svg>', '<path d="M0 0"/></svg>')],
  ['changed plate', svg.replace('M738.35,100.00', 'M738.35,101.00')],
  ['disconnected mark', svg.replace('M398 579', 'M0 0 M398 579')],
]) {
  test(`reject SVG: ${name}`, () => assert.throws(() => validateSvg(badSvg)));
}

test('canonical plate is copied exactly from the player reference', async () => {
  const reference = await readFile(new URL('../signs/dajet-player/icon.svg', import.meta.url), 'utf8');
  assert.equal(svg.match(/<path[^>]+\/>/)[0], reference.match(/<path[^>]+\/>/)[0]);
});

test('ten records have correct dimensions, visible colors and identical duplicate sizes', async () => {
  const seen = new Map();
  for (const { type, size } of records) {
    const rgba = await decodePng(entries.get(type), size);
    assertVisible(pixelStats(rgba), type);
    if (seen.has(size)) assert(entries.get(type).equals(seen.get(size)));
    seen.set(size, entries.get(type));
  }
  assert(packIcns(seen).equals(icns));
});

test('reject invalid header and file length', () => {
  assert.throws(() => unpackIcns(Buffer.alloc(7)), /Truncated/);
  const bad = Buffer.from(icns);
  bad.write('bad!');
  assert.throws(() => unpackIcns(bad), /signature/);
  assert.throws(() => unpackIcns(icns.subarray(0, icns.length - 1)), /length/);
});
test('reject truncated record header', () => {
  assert.throws(() => unpackIcns(container([Buffer.alloc(4)])), /Truncated record/);
});
test('reject zero and oversized record lengths', () => {
  for (const length of [0, 8, 0xffffffff]) {
    const bad = Buffer.from(icns);
    bad.writeUInt32BE(length, 12);
    assert.throws(() => unpackIcns(bad), /Invalid length/);
  }
});
test('reject unknown, duplicate and missing records', () => {
  assert.throws(() => unpackIcns(container([record('xxxx', entries.get('icp4')), ...chunks.slice(1)])), /Unexpected/);
  assert.throws(() => unpackIcns(container([...chunks, chunks[0]])), /Duplicate/);
  assert.throws(() => unpackIcns(container(chunks.slice(1))), /exactly ten/);
});
test('reject non-PNG, invalid PNG data and wrong dimensions', async () => {
  assert.throws(() => unpackIcns(container([record('icp4', Buffer.alloc(9)), ...chunks.slice(1)])), /Non-PNG/);
  await assert.rejects(decodePng(Buffer.from('not an image'), 16));
  await assert.rejects(decodePng(entries.get('icp5'), 16), /width/);
});
test('visibility check rejects transparent, plate-only, mark-only and unrelated color images', () => {
  for (const color of [[0, 0, 0, 0], [21, 24, 28, 255], [232, 174, 140, 255], [0, 255, 0, 255]]) {
    const pixels = Buffer.from(Array.from({ length: 256 }, () => color).flat());
    assert.throws(() => assertVisible(pixelStats(pixels), 'test'), /missing/);
  }
});
test('CLI exits nonzero and reports an empty record while checking all ten', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dajet-icon-'));
  try {
    const empty = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#15181C' } }).png().toBuffer();
    const path = join(temp, 'broken.icns');
    await writeFile(path, container([record('icp4', empty), ...chunks.slice(1)]));
    const result = spawnSync(process.execPath, [new URL('./check-icons.mjs', import.meta.url).pathname, 'dajet-editor', path], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /icp4.*FAIL.*mark/);
    assert.equal(result.stdout.split('\n').filter(line => /^ic\w\w\s/.test(line)).length, 10);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
test('CLI rejects a different image even if both canonical colors are present', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dajet-icon-'));
  try {
    const flipped = await sharp(entries.get('icp4')).flip().png().toBuffer();
    const path = join(temp, 'wrong-mark.icns');
    await writeFile(path, container([record('icp4', flipped), ...chunks.slice(1)]));
    const result = spawnSync(process.execPath, [new URL('./check-icons.mjs', import.meta.url).pathname, 'dajet-editor', path], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /differs from the single-source SVG render/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
