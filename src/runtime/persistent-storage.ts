// Binary field layout follows web-bml/client/binary_table.ts (MIT, otya).
type Field = { type: string; length: number; unit: string; format: string }
type PersistentStorage = Pick<Storage, 'getItem' | 'setItem'>

function invalid(message: string): never {
  throw Object.assign(new TypeError(message), { code: 'INVALID_PARAM_ERR' })
}

function parseStructure(structure: string): Field[] {
  if (typeof structure !== 'string') invalid('Persistent array structure must be a string')
  return structure.split(',').map(format => {
    const match = /^([BUISP]):([1-9][0-9]*)([BbVv])$/.exec(format)
    if (!match) invalid(`Invalid persistent array field: ${format}`)
    const [, type, size, rawUnit] = match
    const length = Number(size)
    const unit = rawUnit === 'v' ? 'V' : rawUnit
    if (!Number.isSafeInteger(length)) invalid('Invalid persistent array field length')
    if (type === 'B' && (length !== 1 || unit !== 'b')) invalid('Boolean fields require B:1b')
    if (type === 'U' && (unit === 'V' || length * (unit === 'B' ? 8 : 1) > 32)) {
      invalid('Unsigned fields support at most 32 bits')
    }
    if (type === 'I' && (unit !== 'B' || ![1, 2, 4].includes(length))) {
      invalid('Signed fields require 1, 2 or 4 bytes')
    }
    if (type === 'S' && (unit === 'b' || (unit === 'V' && length > 4))) {
      invalid('String fields require bytes or a 1 to 4 byte length prefix')
    }
    if (type === 'P' && unit === 'V') invalid('Padding must have a fixed length')
    return { type, length, unit, format }
  })
}

function encode(fields: Field[], values: unknown[]): Uint8Array {
  const bytes: number[] = []
  let position = 0
  let valueIndex = 0
  const write = (value: number, bits: number) => {
    for (let index = bits - 1; index >= 0; index--) {
      const byteIndex = position >> 3
      bytes[byteIndex] = (bytes[byteIndex] ?? 0) |
        (Math.floor(value / 2 ** index) % 2) * 2 ** (7 - (position & 7))
      position++
    }
  }
  for (const field of fields) {
    const bits = field.length * (field.unit === 'b' ? 1 : 8)
    if (field.type === 'P') {
      for (let index = 0; index < bits; index++) write(0, 1)
      continue
    }
    if (valueIndex >= values.length) invalid('Persistent array has too few values')
    const value = values[valueIndex++]
    if (field.type === 'S') {
      if (position & 7) invalid('String fields must be byte aligned')
      const text = new TextEncoder().encode(String(value))
      const length = field.unit === 'V' ? text.length : field.length
      if (field.unit === 'V') {
        if (length >= 2 ** bits) invalid('String exceeds its length prefix')
        write(length, bits)
      }
      for (let index = 0; index < length; index++) write(text[index] ?? 0x20, 8)
    } else if (field.type === 'B') {
      write(value ? 1 : 0, 1)
    } else {
      if (field.type === 'I' && (position & 7)) invalid('Signed fields must be byte aligned')
      const number = Number(value)
      if (!Number.isFinite(number)) invalid('Integer field requires a finite number')
      const modulus = 2 ** bits
      write(((Math.trunc(number) % modulus) + modulus) % modulus, bits)
    }
  }
  return Uint8Array.from(bytes)
}

function decode(fields: Field[], bytes: Uint8Array): unknown[] | null {
  let position = 0
  const values: unknown[] = []
  const read = (bits: number): number => {
    if (position + bits > bytes.length * 8) throw new RangeError('Persistent array is truncated')
    let value = 0
    for (let index = 0; index < bits; index++, position++) {
      value = value * 2 + ((bytes[position >> 3] >> (7 - (position & 7))) & 1)
    }
    return value
  }
  try {
    for (const field of fields) {
      const bits = field.length * (field.unit === 'b' ? 1 : 8)
      if (field.type === 'P') {
        for (let index = 0; index < bits; index++) read(1)
      } else if (field.type === 'S') {
        if (position & 7) invalid('String fields must be byte aligned')
        const length = field.unit === 'V' ? read(bits) : field.length
        if (position + length * 8 > bytes.length * 8) return null
        const text = new TextDecoder().decode(bytes.subarray(position >> 3, (position >> 3) + length))
        values.push(text.split('\0', 1)[0])
        position += length * 8
      } else {
        if (field.type === 'I' && (position & 7)) invalid('Signed fields must be byte aligned')
        const number = read(bits)
        values.push(field.type === 'B' ? number !== 0 :
          field.type === 'I' && number >= 2 ** (bits - 1) ? number - 2 ** bits : number)
      }
    }
    return values
  } catch (error) {
    if (error instanceof RangeError) return null
    throw error
  }
}

/** Owns ordered persistent-array encoding and the document's storage boundary. */
export function createPersistentArrayStorage(storage: PersistentStorage) {
  return {
    read(namespace: string, structure: string): unknown[] | null {
      const fields = parseStructure(structure)
      let raw: string | null
      try { raw = storage.getItem(`arib:nvram:${namespace}`) } catch { return null }
      if (raw === null) return null
      let stored: unknown
      try { stored = JSON.parse(raw) } catch { return null }
      if (Array.isArray(stored)) {
        if (!stored.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) return null
        return decode(fields, Uint8Array.from(stored))
      }
      // Version 0.2.0 keyed values by descriptor. Repeated descriptors lost
      // earlier values; preserve that record and report it as unreadable.
      if (stored && typeof stored === 'object') {
        const entries = Object.entries(stored)
        if (entries.length === 0 || entries.some(([format]) => !/^[BUISP]:[1-9][0-9]*[BbVv]$/.test(format))) return null
        const legacyFields = parseStructure(entries.map(([format]) => format).join(','))
        const requested = fields.filter(field => field.type !== 'P')
        if (new Set(requested.map(field => field.format)).size !== requested.length) return null
        if (requested.some(field => !Object.hasOwn(stored, field.format))) return null
        const bytes = encode(legacyFields, entries.map(([, value]) => value))
        return decode(fields, bytes)
      }
      return null
    },
    write(namespace: string, structure: string, values: unknown[]): number {
      const fields = parseStructure(structure)
      if (!Array.isArray(values)) invalid('Persistent array data must be an array')
      const bytes = encode(fields, values)
      try {
        storage.setItem(`arib:nvram:${namespace}`, JSON.stringify([...bytes]))
        return bytes.length
      } catch {
        return NaN
      }
    },
  }
}
