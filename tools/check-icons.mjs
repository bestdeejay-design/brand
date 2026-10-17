#!/usr/bin/env node
// Проверка готового `.icns`: распаковка обратно и разбор каждой записи.
//
//   node tools/check-icons.mjs                    # все знаки с AppIcon.icns
//   node tools/check-icons.mjs dajet-editor       # один знак
//   node tools/check-icons.mjs path/to/AppIcon.icns
//   node tools/check-icons.mjs --extract ./out    # выложить записи на диск
//
// Что проверяется по каждой записи:
//
//   * сторона PNG совпадает с той, что заявлена записью;
//   * плита на месте и по геометрии (тело 824, по центру);
//   * знак на месте: запись не пустая;
//   * шума нет: цветов вне «плита → знак» нет;
//   * запись нарисована ТАК ЖЕ, как вектор-источник: чекер перерисовывает
//     `icon.svg` на ту же сторону и сравнивает растр. Эта сверка ловит ровно
//     то, что ломало плеер (находка F-1): запись 16 или 32, нарисованная
//     «иначе» — с подменённым штрихом, вручную, другим рендером.
//
// Пустая или шумная запись — ненулевой код выхода.

import fs from 'node:fs'
import path from 'node:path'

import { CANON, ICNS_RECORDS, PLATE_BOX, REPO_ROOT, SIGNS_DIR } from './lib/canon.mjs'
import { isPng, readIcns } from './lib/icns.mjs'
import { analyzePixels, coverageMap, pct, plateBox } from './lib/pixels.mjs'
import { readPixels, renderSvg } from './lib/render.mjs'
import { lintSvg } from './lib/svg-lint.mjs'

// --- пороги ----------------------------------------------------------------

/** Доля знака в записи: ниже — запись считается пустой. */
const MIN_MARK_SHARE = 0.02 // от площади записи
/** Доля чужих цветов: выше — запись считается шумной. */
const MAX_FOREIGN_SHARE = 0.01 // от непрозрачной части
/** Допуск плиты по геометрии, в пикселях. */
const PLATE_TOLERANCE = 1.5
/** Среднее расхождение растра с вектором: выше — запись нарисована иначе. */
const MAX_VECTOR_DRIFT = 0.02

// --- разбор ----------------------------------------------------------------

function pngSize(data) {
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

/** Среднее и максимальное расхождение двух карт покрытия. */
function compareCoverage(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { mean: 1, max: 1 }
  let sum = 0
  let max = 0
  let n = 0
  for (let i = 0; i < a.map.length; i++) {
    const x = a.map[i]
    const y = b.map[i]
    if (x < 0 || y < 0) {
      if (x !== y) {
        sum += 1
        max = Math.max(max, 1)
        n++
      }
      continue
    }
    const d = Math.abs(x - y)
    sum += d
    if (d > max) max = d
    n++
  }
  return { mean: n === 0 ? 0 : sum / n, max }
}

// --- проверка одного файла --------------------------------------------------

function checkFile(file, { extractDir } = {}) {
  const problems = []
  const report = { file, records: [], problems }

  const buffer = fs.readFileSync(file)
  let chunks
  try {
    chunks = readIcns(buffer)
  } catch (error) {
    problems.push(`файл не читается: ${error.message}`)
    return report
  }

  const dir = path.dirname(file)
  const svgPath = path.join(dir, 'icon.svg')
  const hasSvg = fs.existsSync(svgPath)
  const svg = hasSvg ? fs.readFileSync(svgPath, 'utf8') : null
  if (hasSvg) {
    const lint = lintSvg(svg)
    report.lint = lint
    if (!lint.ok) {
      for (const error of lint.errors) problems.push(`вектор: ${error}`)
    }
  }

  // контейнер: ровно десять записей нужных типов
  const expected = ICNS_RECORDS
  if (chunks.length !== expected.length) {
    problems.push(`записей ${chunks.length}, а должно быть ${expected.length}`)
  }
  const byType = new Map(chunks.map((c) => [c.type, c]))
  for (const want of expected) {
    const got = byType.get(want.type)
    if (!got) {
      problems.push(`нет записи ${want.type} (${want.logical})`)
      continue
    }
    if (!isPng(got.data)) {
      problems.push(`запись ${want.type} (${want.logical}) не PNG`)
      continue
    }
    const size = pngSize(got.data)
    if (size.width !== want.pixels || size.height !== want.pixels) {
      problems.push(
        `запись ${want.type} (${want.logical}): PNG ${size.width}×${size.height}, а должно быть ${want.pixels}×${want.pixels}`,
      )
      continue
    }

    const pixels = readPixels(got.data)
    const stats = analyzePixels(pixels)
    const opaque = stats.plate + stats.mark + stats.foreign
    const markShare = stats.total === 0 ? 0 : stats.mark / stats.total
    const foreignShare = opaque === 0 ? 0 : stats.foreign / opaque

    const row = {
      logical: want.logical,
      type: want.type,
      pixels: want.pixels,
      plate: pct(stats.plate, stats.total),
      mark: pct(stats.mark, stats.total),
      foreign: pct(stats.foreign, stats.total),
      transparent: pct(stats.transparent, stats.total),
      markPure: stats.markPure,
      platePure: stats.platePure,
      issues: [],
    }

    // знак есть?
    if (markShare < MIN_MARK_SHARE) {
      row.issues.push(`запись пустая: знака ${(markShare * 100).toFixed(1)}% (< ${MIN_MARK_SHARE * 100}%)`)
    }
    // шум есть?
    if (foreignShare > MAX_FOREIGN_SHARE) {
      const colors = [...stats.foreignColors.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([hex, n]) => `${hex}×${n}`)
      row.issues.push(
        `шум: чужой цвет ${(foreignShare * 100).toFixed(1)}% непрозрачного (> ${MAX_FOREIGN_SHARE * 100}%): ${colors.join(', ')}`,
      )
    }
    // плита на месте и по геометрии?
    const box = plateBox(pixels)
    if (!box) {
      row.issues.push('плиты нет: запись пустая целиком')
    } else {
      const expectedSize = (PLATE_BOX.size * want.pixels) / CANON.canvas
      if (Math.abs(box.width - expectedSize) > PLATE_TOLERANCE || Math.abs(box.height - expectedSize) > PLATE_TOLERANCE) {
        row.issues.push(
          `плита ${box.width}×${box.height}, а по канону ${expectedSize.toFixed(1)}×${expectedSize.toFixed(1)} (тело ${PLATE_BOX.size} при канве ${CANON.canvas})`,
        )
      }
    }
    // запись нарисована так же, как вектор?
    if (svg) {
      const reference = readPixels(renderSvg(svg, want.pixels))
      const drift = compareCoverage(coverageMap(pixels), coverageMap(reference))
      row.drift = drift.mean
      if (drift.mean > MAX_VECTOR_DRIFT) {
        row.issues.push(
          `запись нарисована иначе, чем вектор: расхождение ${drift.mean.toFixed(3)} (> ${MAX_VECTOR_DRIFT}) — штрих подменён или запись перерисована`,
        )
      }
    }

    if (extractDir) {
      fs.mkdirSync(extractDir, { recursive: true })
      const name = path.basename(file).replace(/\.icns$/, '')
      fs.writeFileSync(path.join(extractDir, `${name}-${want.logical.replace('@', '-at-')}.png`), got.data)
    }

    for (const issue of row.issues) problems.push(`${want.type} (${want.logical}): ${issue}`)
    report.records.push(row)
  }

  return report
}

// --- main -------------------------------------------------------------------

const args = process.argv.slice(2)
const extractIndex = args.indexOf('--extract')
const extractDir = extractIndex >= 0 ? args[extractIndex + 1] : null
if (extractIndex >= 0) args.splice(extractIndex, 2)
const targets = args.filter((a) => !a.startsWith('--'))

let files = []
if (targets.length > 0) {
  files = targets.map((t) => {
    const asPath = path.resolve(REPO_ROOT, t)
    if (fs.existsSync(asPath) && fs.statSync(asPath).isFile()) return asPath
    const asSign = path.join(SIGNS_DIR, t, 'AppIcon.icns')
    if (fs.existsSync(asSign)) return asSign
    console.error(`нет такой цели: ${t}`)
    process.exit(2)
  })
} else {
  if (fs.existsSync(SIGNS_DIR)) {
    for (const key of fs.readdirSync(SIGNS_DIR, { withFileTypes: true })) {
      if (!key.isDirectory()) continue
      const candidate = path.join(SIGNS_DIR, key.name, 'AppIcon.icns')
      if (fs.existsSync(candidate)) files.push(candidate)
    }
  }
  files.sort()
}

if (files.length === 0) {
  console.error('нечего проверять: в signs/ нет ни одного AppIcon.icns')
  process.exit(2)
}

let failures = 0

for (const file of files) {
  const report = checkFile(file, { extractDir })
  const key = path.relative(REPO_ROOT, file)
  console.log(`\n${key}`)
  if (report.lint) {
    const state = report.lint.ok ? 'канон соблюдён' : 'КАНОН НАРУШЕН'
    console.log(`  вектор: ${state} — цвета ${report.lint.info.colors.join(', ') || '—'}`)
  }
  console.log('  запись        сторона   плита     знак     чужой   прозрачно  сверка с вектором')
  for (const row of report.records) {
    const drift = row.drift === undefined ? '—' : `${row.drift.toFixed(3)}`
    console.log(
      `  ${row.logical.padEnd(13)} ${String(row.pixels).padStart(4)} px  ${row.plate.toFixed(1).padStart(6)}%  ${row.mark.toFixed(1).padStart(6)}%  ${row.foreign.toFixed(1).padStart(5)}%  ${row.transparent.toFixed(1).padStart(6)}%  ${drift.padStart(6)}`,
    )
    for (const issue of row.issues) console.log(`      ! ${issue}`)
  }
  if (report.problems.length > 0) {
    failures++
    console.log(`  ИТОГ: провал — ${report.problems.length} замечани(й)`)
  } else {
    console.log('  ИТОГ: все записи на месте, плита и знак в каждой')
  }
}

if (extractDir) console.log(`\nзаписи выложены в ${path.relative(REPO_ROOT, path.resolve(extractDir)) || extractDir}`)

if (failures > 0) {
  console.error(`\nпровалено файлов: ${failures}`)
  process.exit(1)
}
console.log('\nвсе файлы в порядке')
