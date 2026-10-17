import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { records, unpackIcns, decodePng, pixelStats, assertVisible, renderSizes, signDirectory } from './icon-lib.mjs';

try {
  const directory = signDirectory(process.argv[2] || 'dajet-editor');
  const iconPath = process.argv[3] || new URL('AppIcon.icns', directory);
  const svgPath = process.argv[4] || new URL('icon.svg', directory);
  const entries = unpackIcns(await readFile(iconPath));
  const expected = await renderSizes(await readFile(svgPath, 'utf8'));
  console.log('Type  Logical  Pixels     Plate %   Mark %    Exact plate/mark %  Result');
  const failures = [];
  const pct = (value, pixels) => (100 * value / pixels).toFixed(2).padStart(6);
  for (const { type, logical, scale, size } of records) {
    const label = `${type}  ${`${logical}@${scale}x`.padEnd(7)}  ${`${size}×${size}`.padEnd(9)}`;
    let fractions = '';
    try {
      const actual = await decodePng(entries.get(type), size);
      const stats = pixelStats(actual);
      fractions = `${pct(stats.plate, stats.pixels)}    ${pct(stats.mark, stats.pixels)}    ${pct(stats.exactPlate, stats.pixels)}/${pct(stats.exactMark, stats.pixels)}`;
      assertVisible(stats, type);
      const reference = await decodePng(expected.get(size), size);
      assert(actual.equals(reference), `${type}: record differs from the single-source SVG render`);
      console.log(`${label} ${fractions}  PASS`);
    } catch (error) {
      console.log(`${label} ${fractions}  FAIL: ${error.message}`);
      failures.push(type);
    }
  }
  assert.equal(failures.length, 0, `Failed records: ${failures.join(', ')}`);
  console.log('PASS: 10/10 records; both colors present; all pixels match vector-derived renders.');
  console.log('Fractions use all canvas pixels; α ≥ 240, RGB distance ≤ 48. Exact columns: α = 255, distance = 0.');
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
