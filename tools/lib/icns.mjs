// Контейнер `.icns` — чтение и запись.
//
// Формат: магия `icns`, общая длина файла (big-endian), затем записи вида
// `type` (4 байта) + длина (4 байта, big-endian, вместе с заголовком) + данные.
// Внутри записи лежит PNG (macOS 10.7+ читает только PNG-записи — «сырые»
// типы `is32`/`il32`/`it32` не нужны и не поддерживаются).

export const ICNS_MAGIC = 'icns'

export function writeIcns(records) {
  const chunks = records.map(({ type, data }) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 4, 'ascii')
    head.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([head, data])
  })
  const body = Buffer.concat(chunks)
  const header = Buffer.alloc(8)
  header.write(ICNS_MAGIC, 0, 4, 'ascii')
  header.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([header, body])
}

export function readIcns(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) {
    throw new Error('файл слишком короткий для .icns')
  }
  const magic = buffer.toString('ascii', 0, 4)
  if (magic !== ICNS_MAGIC) {
    throw new Error(`не .icns: магия «${magic}» вместо «${ICNS_MAGIC}»`)
  }
  const declared = buffer.readUInt32BE(4)
  if (declared !== buffer.length) {
    throw new Error(`заголовок объявляет ${declared} байт, в файле ${buffer.length}`)
  }
  const records = []
  let offset = 8
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) throw new Error('обрезан заголовок записи')
    const type = buffer.toString('ascii', offset, offset + 4)
    const length = buffer.readUInt32BE(offset + 4)
    if (length < 8 || offset + length > buffer.length) {
      throw new Error(`неверная длина записи ${type}: ${length}`)
    }
    records.push({ type, data: buffer.subarray(offset + 8, offset + length) })
    offset += length
  }
  return records
}

export const isPng = (data) =>
  Buffer.isBuffer(data) &&
  data.length > 24 &&
  data[0] === 0x89 &&
  data.toString('ascii', 1, 4) === 'PNG'
