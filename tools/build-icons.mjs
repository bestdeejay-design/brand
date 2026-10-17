#!/usr/bin/env node
// Сборка знака: `signs/<ключ>/icon.svg` → `AppIcon.icns` + рендеры.
//
//   node tools/build-icons.mjs                 # все знаки, проходящие канон
//   node tools/build-icons.mjs dajet-editor    # один знак
//   node tools/build-icons.mjs dajet-editor --force
//
// Что здесь важно (канон, §1 и §4):
//
//   * одна плита, один знак, один штрих 92 — на ВСЕХ размерах. Малые записи
//     не перерисовываются и не получают «оптически более жирный» штрих:
//     вектор просто рендерится заново на каждое разрешение;
//   * `.icns` пишется вручную, без `iconutil` (macOS тут нет);
//   * повторный прогон даёт побайтово те же файлы.
//
// Перед сборкой вектор проходит линт по канону (ровно два цвета, никаких
// градиентов, теней и прозрачности, штрих 92 с круглыми концами). Знак, который
// канону не соответствует, не собирается: чтобы его всё-таки собрать, нужен
// `--force`. Плита (канва 1024, плита 1024 без полей, по центру) обязательна всегда: `--force`
// её не отменяет — без неё это не знак, а картинка.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

import { CANON, ICNS_RECORDS, PLATE_BOX, SIGNS_DIR, listSigns } from './lib/canon.mjs'
import { writeIcns } from './lib/icns.mjs'
import { plateBox } from './lib/pixels.mjs'
import { magnify, readPixels, renderSvg } from './lib/render.mjs'
import { lintSvg } from './lib/svg-lint.mjs'

const PREVIEW_FACTOR = { 16: 16, 32: 8 } // 16 px → 256×256, 32 px → 256×256

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12)

const args = process.argv.slice(2)
const force = args.includes('--force')
const quiet = args.includes('--quiet')
const requested = args.filter((a) => !a.startsWith('--'))

const log = (...parts) => {
  if (!quiet) console.log(...parts)
}

function signDir(key) {
  return path.join(SIGNS_DIR, key)
}

function buildSign(key) {
  const dir = signDir(key)
  const svgPath = path.join(dir, 'icon.svg')
  const svg = fs.readFileSync(svgPath, 'utf8')

  const lint = lintSvg(svg)
  if (!lint.ok && !force) {
    return { key, ok: false, stage: 'lint', lint }
  }

  // плита: плита 1024 без полей, по центру канвы
  const png1024 = renderSvg(svg, CANON.canvas)
  const bounds = plateBox(readPixels(png1024))
  if (
    !bounds ||
    bounds.width !== PLATE_BOX.size ||
    bounds.height !== PLATE_BOX.size ||
    bounds.minX !== PLATE_BOX.x ||
    bounds.minY !== PLATE_BOX.y
  ) {
    return {
      key,
      ok: false,
      stage: 'plate',
      error: `плита занимает ${bounds ? `${bounds.width}×${bounds.height} с (${bounds.minX},${bounds.minY})` : 'ничего'}, а по канону ${PLATE_BOX.size}×${PLATE_BOX.size} с (${PLATE_BOX.x},${PLATE_BOX.y})`,
    }
  }

  const files = []

  fs.writeFileSync(path.join(dir, 'icon-1024.png'), png1024)
  files.push(['icon-1024.png', png1024])

  for (const size of [16, 32]) {
    const record = renderSvg(svg, size)
    const preview = magnify(record, PREVIEW_FACTOR[size])
    fs.writeFileSync(path.join(dir, `preview-${size}.png`), preview)
    files.push([`preview-${size}.png`, preview])
  }

  // .icns: десять записей, каждая — рендер того же вектора
  const records = ICNS_RECORDS.map(({ type, pixels }) => ({
    type,
    data: renderSvg(svg, pixels),
  }))
  const icns = writeIcns(records)
  fs.writeFileSync(path.join(dir, 'AppIcon.icns'), icns)
  files.push(['AppIcon.icns', icns])

  return { key, ok: true, files, lint }
}

// --- main -------------------------------------------------------------------

const all = listSigns()
const keys = requested.length > 0 ? requested : all
const unknown = keys.filter((k) => !all.includes(k))
if (unknown.length > 0) {
  console.error(`нет такого знака: ${unknown.join(', ')}. Есть: ${all.join(', ') || '—'}`)
  process.exit(2)
}

log(`сборка: ${keys.join(', ')}`)

let failed = 0
let skipped = 0
for (const key of keys) {
  const explicit = requested.includes(key)
  const result = buildSign(key)

  if (result.ok) {
    if (result.lint && !result.lint.ok) {
      // собрано принудительно: канон нарушен, но это решение владельца
      console.error(`\n! ${key}: собрано принудительно, канон нарушен — ${result.lint.errors.join('; ')}`)
      console.error(`  check-icons.mjs такой знак не пропустит.`)
    }
    log(`\n✓ ${key}`)
    for (const [name, buffer] of result.files) {
      log(`  ${name.padEnd(16)} ${String(buffer.length).padStart(7)} Б  sha256:${sha256(buffer)}`)
    }
    continue
  }

  if (result.stage === 'lint') {
    const message = result.lint.errors.join('; ')
    if (!explicit) {
      log(`\n— ${key}: пропущен, канон не соблюдён (${message}). Собрать принудительно: --force ${key}`)
      skipped++
      continue
    }
    console.error(`\n✗ ${key}: канон не соблюдён — ${message}`)
    console.error(`  Собрать принудительно: --force ${key}`)
    failed++
    continue
  }

  if (result.stage === 'plate') {
    console.error(`\n✗ ${key}: ${result.error}`)
    console.error(`  Плита — часть канона, --force её не отменяет.`)
    failed++
    continue
  }
}

if (skipped > 0) log(`\nпропущено знаков: ${skipped} (канон не соблюдён)`)
if (failed > 0) {
  console.error(`\nне собрано: ${failed}`)
  process.exit(1)
}
log('\nготово')
