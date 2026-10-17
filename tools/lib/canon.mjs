// Канон в машинном виде.
//
// Единственный источник правды — `palette.json` в корне репозитория: цвета,
// геометрия и состав записей `.icns` читаются оттуда. Здесь только то, чего в
// `palette.json` нет: типы контейнера `.icns` и разбор его же — формат
// описан в `tools/README.md`.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const SIGNS_DIR = path.join(REPO_ROOT, 'signs')

export const palette = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'palette.json'), 'utf8'))

export const CANON = {
  plate: palette.icon.plate.toUpperCase(),
  mark: palette.icon.mark.toUpperCase(),
  canvas: palette.geometry.canvas,
  body: palette.geometry.body,
  cornerFactor: palette.geometry.corner.factor,
  cornerRadius: palette.geometry.corner.factor * palette.geometry.corner.applied_to,
  stroke: palette.geometry.linear_stroke,
  strokeCap: palette.geometry.stroke_cap,
  legibilityPx: palette.geometry.legibility_check_px,
}

export const hexToRgb = (hex) => {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

export const rgbToHex = ([r, g, b]) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()

export const PLATE_RGB = hexToRgb(CANON.plate)
export const MARK_RGB = hexToRgb(CANON.mark)

/**
 * Десять записей `.icns` — ровно те, что перечислены в `palette.json`
 * (`icns.records`), в порядке от мелкой к крупной.
 *
 * `type` — четырёхсимвольный тип записи в контейнере `.icns`:
 *   `icp4/icp5/ic07..ic10` — записи 1× (16, 32, 128, 256, 512, 1024),
 *   `ic11..ic14` — соответствующие записи 2× (32, 64, 256, 512).
 * `pixels` — сторона PNG внутри записи в пикселях.
 */
export const ICNS_RECORDS = [
  { logical: '16x16', type: 'icp4', pixels: 16 },
  { logical: '16x16@2x', type: 'ic11', pixels: 32 },
  { logical: '32x32', type: 'icp5', pixels: 32 },
  { logical: '32x32@2x', type: 'ic12', pixels: 64 },
  { logical: '128x128', type: 'ic07', pixels: 128 },
  { logical: '128x128@2x', type: 'ic13', pixels: 256 },
  { logical: '256x256', type: 'ic08', pixels: 256 },
  { logical: '256x256@2x', type: 'ic14', pixels: 512 },
  { logical: '512x512', type: 'ic09', pixels: 512 },
  { logical: '512x512@2x', type: 'ic10', pixels: 1024 },
]

// `palette.json` — источник правды по составу: если он разойдётся с таблицей
// выше, сборка обязана упасть, а не молча собрать другой набор записей.
{
  const declared = palette.icns.records.map((r) => r.replace(/x/g, 'x'))
  const mine = ICNS_RECORDS.map((r) => r.logical)
  const same = declared.length === mine.length && declared.every((d, i) => d === mine[i])
  if (!same) {
    throw new Error(
      `palette.json (icns.records: ${declared.join(', ')}) и tools/lib/canon.mjs (${mine.join(', ')}) разошлись`,
    )
  }
}

// CONCEPT.md §1, §4: macOS 26 требует плиту без полей, не старое тело 824.
// Не допускаем тихого возврата старой сетки через устаревший palette.json.
if (CANON.canvas !== 1024 || CANON.body !== CANON.canvas ||
    CANON.cornerFactor !== 0.2253 || CANON.cornerRadius !== 0.2253 * 1024 ||
    CANON.stroke !== 92 || palette.geometry.plate_fills_canvas !== true ||
    palette.icon.plate_margin !== 0) {
  throw new Error('Геометрия palette.json противоречит CONCEPT.md §1, §4: плита 1024 без полей, угол 0.2253 × 1024, штрих 92')
}

/** Плита занимает всю канву; прозрачны только скруглённые углы. */
export const PLATE_BOX = {
  x: 0,
  y: 0,
  size: CANON.canvas,
}

/** Список знаков: папки в `signs/`, где лежит `icon.svg`. */
export function listSigns() {
  if (!fs.existsSync(SIGNS_DIR)) return []
  return fs
    .readdirSync(SIGNS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((key) => fs.existsSync(path.join(SIGNS_DIR, key, 'icon.svg')))
    .sort()
}
