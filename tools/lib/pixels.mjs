// Разбор пикселей записи: сколько в ней плиты, сколько знака и есть ли что-то
// третье.
//
// Цвета знака — ровно два: плита `#15181C` и знак `#E8AE8C`. Поэтому каждый
// пиксель проецируется на отрезок «плита → знак»:
//
//   * проекция лежит на отрезке (цвет — смесь плиты и знака, сглаживание) —
//     пиксель принадлежит плите или знаку по тому, где он ближе;
//   * проекция ушла с отрезка (цвет уходит в сторону: другой оттенок, шум,
//     «цветное пятно») — пиксель чужой, и это дефект.
//
// Так ловится ровно то, что ловить нужно: запись, нарисованная «иначе»
// (находка F-1 — две записи с подменённым штрихом), видна как чужой цвет,
// а не как «просто маленькая картинка».

import { PLATE_RGB, MARK_RGB, rgbToHex } from './canon.mjs'

const AXIS = MARK_RGB.map((c, i) => c - PLATE_RGB[i])
const AXIS_LEN2 = AXIS.reduce((s, v) => s + v * v, 0)

export const OFF_AXIS_TOLERANCE = 24
export const ALPHA_FLOOR = 8

/** Насколько цвет уходит с отрезка «плита → знак». */
export const offAxisDistance = (r, g, b) => {
  const p = [r - PLATE_RGB[0], g - PLATE_RGB[1], b - PLATE_RGB[2]]
  const t = Math.max(0, Math.min(1, (p[0] * AXIS[0] + p[1] * AXIS[1] + p[2] * AXIS[2]) / AXIS_LEN2))
  const q = [
    PLATE_RGB[0] + t * AXIS[0],
    PLATE_RGB[1] + t * AXIS[1],
    PLATE_RGB[2] + t * AXIS[2],
  ]
  return Math.hypot(r - q[0], g - q[1], b - q[2])
}

/**
 * Карта покрытия записи: 0 — плита, 1 — знак, -1 — прозрачно, -2 — чужой цвет.
 * Одновременно источник счётчиков и основа для сверки записи с вектором.
 */
export function coverageMap({ width, height, data }) {
  const map = new Float64Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const a = data[i * 4 + 3]
    if (a < ALPHA_FLOOR) {
      map[i] = -1
      continue
    }
    const p = [r - PLATE_RGB[0], g - PLATE_RGB[1], b - PLATE_RGB[2]]
    const t = Math.max(0, Math.min(1, (p[0] * AXIS[0] + p[1] * AXIS[1] + p[2] * AXIS[2]) / AXIS_LEN2))
    if (offAxisDistance(r, g, b) > OFF_AXIS_TOLERANCE) {
      map[i] = -2
      continue
    }
    map[i] = t
  }
  return { width, height, map }
}

/**
 * Счёт по записи.
 * @returns {{plate:number, mark:number, foreign:number, transparent:number,
 *            total:number, platePure:number, markPure:number,
 *            foreignColors:Map<string,number>}}
 */
export function analyzePixels(pixels) {
  const { width, height, data } = pixels
  const { map } = coverageMap(pixels)

  let plate = 0
  let mark = 0
  let foreign = 0
  let transparent = 0
  let platePure = 0
  let markPure = 0
  const foreignColors = new Map()

  for (let i = 0; i < width * height; i++) {
    const v = map[i]
    if (v === -1) {
      transparent++
      continue
    }
    if (v === -2) {
      foreign++
      const r = data[i * 4]
      const g = data[i * 4 + 1]
      const b = data[i * 4 + 2]
      const key = rgbToHex([r, g, b])
      foreignColors.set(key, (foreignColors.get(key) ?? 0) + 1)
      continue
    }
    if (v < 0.5) plate++
    else mark++

    const a = data[i * 4 + 3]
    if (a === 255) {
      const r = data[i * 4]
      const g = data[i * 4 + 1]
      const b = data[i * 4 + 2]
      if (r === PLATE_RGB[0] && g === PLATE_RGB[1] && b === PLATE_RGB[2]) platePure++
      if (r === MARK_RGB[0] && g === MARK_RGB[1] && b === MARK_RGB[2]) markPure++
    }
  }

  const total = width * height
  return {
    plate,
    mark,
    foreign,
    transparent,
    total,
    platePure,
    markPure,
    foreignColors,
  }
}

/** Границы непрозрачной части (плиты) в пикселях. */
export function plateBox({ width, height, data }) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 127) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

export const pct = (value, total) => (total === 0 ? 0 : (value / total) * 100)
