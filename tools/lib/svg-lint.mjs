// Линт вектора-источника по канону.
//
// Канон требует от знака ровно двух цветов (плита и знак), полной плоскости
// (никаких градиентов, теней, прозрачностей) и одного штриха толщиной 74 с
// круглыми концами. Всё это проверяется по исходному тексту `icon.svg` — до
// того, как что-то собрано.
//
// Разбор — регулярками: файл знака это плоский SVG из двух-трёх элементов,
// полноценный XML-парсер здесь был бы лишней зависимостью.

import { CANON } from './canon.mjs'

const FORBIDDEN_ELEMENTS = {
  defs: '`<defs>` в знаке запрещён',
  linearGradient: 'градиент запрещён',
  radialGradient: 'градиент запрещён',
  filter: 'фильтр (тень, размытие) запрещён',
  feGaussianBlur: 'фильтр (тень, размытие) запрещён',
  feDropShadow: 'тень запрещена',
  mask: 'маска запрещена',
  pattern: 'паттерн запрещён',
  clipPath: 'обрезка запрещена',
  image: 'растр в векторе запрещён',
  style: '`<style>` запрещён: стили прячут градиенты и прозрачность',
}

const FORBIDDEN_ATTRS = {
  opacity: 'полупрозрачность запрещена',
  'fill-opacity': 'полупрозрачность запрещена',
  'stroke-opacity': 'полупрозрачность запрещена',
  filter: 'фильтр (тень, размытие) запрещён',
  mask: 'маска запрещена',
  'clip-path': 'обрезка запрещена',
  style: 'инлайн-стили запрещены: стили прячут градиенты и прозрачность',
}

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g
const TAG_RE = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g

const parseAttrs = (chunk) => {
  const attrs = {}
  let m
  ATTR_RE.lastIndex = 0
  while ((m = ATTR_RE.exec(chunk)) !== null) {
    attrs[m[1].toLowerCase()] = m[2]
  }
  return attrs
}

export function lintSvg(svgSource) {
  const errors = []
  const colors = new Set()
  const strokeWidths = new Set()
  const caps = new Set()
  const elements = []

  // канва
  const root = /<svg\b((?:[^>"']|"[^"]*"|'[^']*')*)/.exec(svgSource)
  if (!root) {
    return { ok: false, errors: ['файл не похож на SVG'], info: {} }
  }
  const rootAttrs = parseAttrs(root[1])
  const viewBox = (rootAttrs.viewbox ?? '').trim()
  if (rootAttrs.width !== String(CANON.canvas) || rootAttrs.height !== String(CANON.canvas)) {
    errors.push(`канва должна быть ${CANON.canvas}×${CANON.canvas}, а не ${rootAttrs.width}×${rootAttrs.height}`)
  }
  if (viewBox !== `0 0 ${CANON.canvas} ${CANON.canvas}`) {
    errors.push(`viewBox должен быть «0 0 ${CANON.canvas} ${CANON.canvas}», а не «${viewBox}»`)
  }

  // элементы и атрибуты
  let tag
  TAG_RE.lastIndex = 0
  while ((tag = TAG_RE.exec(svgSource)) !== null) {
    const name = tag[1]
    const attrs = parseAttrs(tag[2] ?? '')
    elements.push(name)

    if (FORBIDDEN_ELEMENTS[name]) errors.push(FORBIDDEN_ELEMENTS[name])

    for (const [attr, message] of Object.entries(FORBIDDEN_ATTRS)) {
      if (attr in attrs) {
        const value = attrs[attr]
        if (attr === 'opacity' && value.trim() === '1') continue
        errors.push(`${message} (${name} ${attr}="${value}")`)
      }
    }

    for (const attr of ['fill', 'stroke', 'stop-color', 'color']) {
      const value = attrs[attr]
      if (value === undefined) continue
      const v = value.trim()
      if (v === 'none' || v === 'currentColor') continue
      if (v.startsWith('url(')) {
        errors.push(`ссылка на определение в ${attr}="${v}" — градиент, паттерн или маска запрещены`)
        continue
      }
      colors.add(v.toUpperCase())
    }

    if (attrs['stroke-width'] !== undefined) {
      strokeWidths.add(attrs['stroke-width'].trim())
    }
    if (attrs.stroke !== undefined && attrs.stroke.trim() !== 'none') {
      caps.add((attrs['stroke-linecap'] ?? '—').trim())
    }
  }

  // цвета
  const allowed = new Set([CANON.plate, CANON.mark])
  for (const color of colors) {
    if (!allowed.has(color)) errors.push(`цвет ${color} — не из палитры (в знаке ровно два цвета)`)
  }
  if (colors.size > 2) {
    errors.push(`в знаке ${colors.size} цвета: ${[...colors].join(', ')} — по канону ровно два`)
  }
  if (colors.size < 2) {
    errors.push(`в знаке меньше двух цветов (${[...colors].join(', ') || 'нет'}) — нужны плита и знак`)
  }

  // штрих
  for (const width of strokeWidths) {
    if (Number(width) !== CANON.stroke) {
      errors.push(`штрих ${width} — по канону ${CANON.stroke} при канве ${CANON.canvas}`)
    }
  }
  for (const cap of caps) {
    if (cap !== CANON.strokeCap) {
      errors.push(`концы штриха «${cap}» — по канону ${CANON.strokeCap}`)
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    info: {
      colors: [...colors].sort(),
      strokeWidths: [...strokeWidths],
      caps: [...caps],
      elements: [...new Set(elements)].sort(),
      canvas: `${rootAttrs.width}×${rootAttrs.height}`,
      viewBox,
    },
  }
}
