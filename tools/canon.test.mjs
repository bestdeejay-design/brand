import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { CANON, ICNS_RECORDS, PLATE_BOX, PLATE_RGB, SIGNS_DIR, REPO_ROOT } from './lib/canon.mjs'
import { readIcns, writeIcns } from './lib/icns.mjs'
import { readPixels, renderSvg } from './lib/render.mjs'
import { lintSvg } from './lib/svg-lint.mjs'

const svgFor = key => fs.readFileSync(path.join(SIGNS_DIR, key, 'icon.svg'), 'utf8')

test('CONCEPT §1, §4: full canvas, canonical corner and stroke', () => {
  assert.equal(CANON.canvas, 1024)
  assert.equal(CANON.body, 1024)
  assert.equal(CANON.cornerRadius, 0.2253 * 1024)
  assert.equal(CANON.stroke, 92)
  assert.deepEqual(PLATE_BOX, { x: 0, y: 0, size: 1024 })
  for (const key of ['dajet-editor', 'dajet-player']) {
    assert.equal(lintSvg(svgFor(key)).ok, true)
    assert.equal(lintSvg(svgFor(key).replace('stroke-width="92"', 'stroke-width="74"')).ok, false)
  }
})

test('cup corners: radius is a valid pill, lint rejects negative and oversized rx/ry', () => {
  const svg = svgFor('dajet-editor')

  // чашки наушников — «пилюли»: радиус ровно половина меньшей стороны
  const cups = [...svg.matchAll(/<rect\b([^>]*)>/g)].map((m) => m[1])
  assert.equal(cups.length, 2, 'в знаке редактора ровно две чашки')
  for (const cup of cups) {
    const rx = /rx="([^"]+)"/.exec(cup)
    const width = Number(/width="([^"]+)"/.exec(cup)[1])
    const height = Number(/height="([^"]+)"/.exec(cup)[1])
    assert.ok(rx, `у чашки нет rx: ${cup.trim()}`)
    assert.ok(Number(rx[1]) > 0, `rx чашки «${rx[1]}» не положителен — отрицательный радиус обнуляется`)
    assert.ok(
      Math.abs(Number(rx[1]) - Math.min(width, height) / 2) < 1e-3,
      `rx чашки «${rx[1]}» — не половина меньшей стороны ${Math.min(width, height) / 2}`,
    )
  }

  // старый файл: rx="-44.7379" — отрицательный, рендерер его обнуляет,
  // чашки выходят прямоугольниками и знак читается как арка
  const legacy = svg.replace(/rx="[\d.]+"/g, 'rx="-44.7379"')
  assert.notEqual(legacy, svg, 'подмена радиуса ничего не изменила — тест не проверяет то, что должен')
  const negative = lintSvg(legacy)
  assert.equal(negative.ok, false, 'линг пропустил отрицательный rx')
  assert.match(negative.errors.join('; '), /отрицательный радиус/)

  // радиус больше половины меньшей стороны — тоже невалиден
  const oversized = svg.replace(/rx="[\d.]+"/g, 'rx="120"')
  const tooBig = lintSvg(oversized)
  assert.equal(tooBig.ok, false, 'линг пропустил радиус больше половины меньшей стороны')
  assert.match(tooBig.errors.join('; '), /больше половины меньшей стороны/)

  // и ни у одного знака нет invalid-радиуса прямо сейчас
  for (const key of ['dajet-editor', 'dajet-player']) {
    assert.deepEqual(lintSvg(svgFor(key)).errors, [], `${key}: линг нашёл ошибки`)
  }
})

test('all ten records reach every canvas edge with opaque plate color', () => {
  for (const key of ['dajet-editor', 'dajet-player']) {
    const records = readIcns(fs.readFileSync(path.join(SIGNS_DIR, key, 'AppIcon.icns')))
    assert.equal(records.length, 10)
    for (const expected of ICNS_RECORDS) {
      const { width, height, data } = readPixels(records.find(r => r.type === expected.type).data)
      assert.equal(width, expected.pixels)
      assert.equal(height, expected.pixels)
      const middle = Math.floor(width / 2)
      for (const [x, y] of [[middle, 0], [middle, height - 1], [0, middle], [width - 1, middle]]) {
        const offset = (y * width + x) * 4
        assert.deepEqual([...data.subarray(offset, offset + 4)], [...PLATE_RGB, 255], `${key}/${expected.type}: edge (${x},${y})`)
      }
    }
  }
})

test('checker rejects old 824 plate even when every record matches its SVG', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-canon-'))
  try {
    const svg = svgFor('dajet-editor').replace(/(<svg[^>]*>)/, '$1<g transform="translate(100 100) scale(0.8046875)">').replace('</svg>', '</g></svg>')
    fs.writeFileSync(path.join(dir, 'icon.svg'), svg)
    const file = path.join(dir, 'AppIcon.icns')
    fs.writeFileSync(file, writeIcns(ICNS_RECORDS.map(({ type, pixels }) => ({ type, data: renderSvg(svg, pixels) }))))
    const result = spawnSync(process.execPath, ['tools/check-icons.mjs', file], { cwd: REPO_ROOT, encoding: 'utf8' })
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stdout, /плита 824×824, а по канону 1024\.0×1024\.0/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
