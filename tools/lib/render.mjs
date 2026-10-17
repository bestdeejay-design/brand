// Рендер вектора и работа с пикселями.
//
// Рендер — resvg: вектор рисуется заново на каждое целевое разрешение из
// одного и того же файла `icon.svg`, с одним и тем же штрихом. Ни одна запись
// не перерисовывается «под размер», малые записи не получают другого штриха
// (именно это сломало записи 16 и 32 у плеера — находка F-1).
//
// Увеличение для предпросмотров — честное «без сглаживания»: ближайший сосед,
// рядом к каждому пикселю копируется один и тот же цвет, чтобы глаз увидел
// настоящий растр записи, а не сглаженную картинку.

import { Resvg } from '@resvg/resvg-js'
import { PNG } from 'pngjs'

/** Рендер SVG в PNG заданной стороны (в пикселях). */
export function renderSvg(svgSource, size) {
  const resvg = new Resvg(svgSource, {
    fitTo: { mode: 'width', value: size },
    logLevel: 'error',
  })
  const rendered = resvg.render()
  if (rendered.width !== size || rendered.height !== size) {
    throw new Error(`рендер ${size}×${size} дал ${rendered.width}×${rendered.height}`)
  }
  return rendered.asPng()
}

/** Увеличение без сглаживания: один пиксель → `factor` × `factor`. */
export function magnify(pngBuffer, factor) {
  const src = PNG.sync.read(pngBuffer)
  const out = new PNG({ width: src.width * factor, height: src.height * factor })
  for (let y = 0; y < out.height; y++) {
    const sy = Math.floor(y / factor)
    for (let x = 0; x < out.width; x++) {
      const sx = Math.floor(x / factor)
      const si = (sy * src.width + sx) * 4
      const di = (y * out.width + x) * 4
      out.data[di] = src.data[si]
      out.data[di + 1] = src.data[si + 1]
      out.data[di + 2] = src.data[si + 2]
      out.data[di + 3] = src.data[si + 3]
    }
  }
  return PNG.sync.write(out, { deflateLevel: 9, deflateStrategy: 3 })
}

/** Сырые пиксели PNG: RGBA, по рядам. */
export function readPixels(pngBuffer) {
  const png = PNG.sync.read(pngBuffer)
  return { width: png.width, height: png.height, data: png.data }
}
