import assert from 'node:assert/strict'
import { createPersistentArrayStorage } from '../../src/runtime/persistent-storage.ts'

const records = new Map()
const storage = {
  getItem(key) { return records.get(key) ?? null },
  setItem(key, value) { records.set(key, value) },
}
const arrays = createPersistentArrayStorage(storage)
const namespace = 'nvram://05;bs_local/11'
assert.equal(arrays.read(namespace, 'U:1B,U:1B'), null)
assert.equal(arrays.write(namespace, 'U:1B,U:1B', [1, 2]), 2)
assert.deepEqual(arrays.read(namespace, 'U:1B,U:1B'), [1, 2])
assert.deepEqual(arrays.read(namespace, 'U:1B'), [1])
assert.deepEqual(arrays.read(namespace, 'U:2B'), [258])

const mixed = 'U:4b,B:1b,P:3b,I:2B,S:4B,S:1V'
assert.equal(arrays.write(namespace, mixed, [15, true, -123, 'A', '日本語']), 17)
assert.deepEqual(arrays.read(namespace, mixed), [15, true, -123, 'A   ', '日本語'])
assert.equal(arrays.write(namespace, 'U:4B,I:4B', [0xffffffff, -2147483648]), 8)
assert.deepEqual(arrays.read(namespace, 'U:4B,I:4B'), [0xffffffff, -2147483648])
assert.equal(arrays.read(namespace, 'S:1V'), null)
assert.throws(() => arrays.write(namespace, 'U:0B', [1]), { code: 'INVALID_PARAM_ERR' })
assert.throws(() => arrays.write(namespace, 'U:1B,U:1B', [1]), { code: 'INVALID_PARAM_ERR' })

// Real BS TV Tokyo NVRAM layout: bit-packed timestamp and repeated strings.
const format = 'U:6b,U:5b,U:5b,U:4b,U:12b,S:4B,S:1B,S:1B,S:22B,S:1B,S:1B,S:22B,S:8B'
const values = [30, 15, 30, 10, 2026, 'X_BJ', '0', '0', '0123456789012345678901', '0', '0', 'abcdefghijklmnopqrstuv', '12345678']
assert.equal(arrays.write(namespace, format, values), 64)
assert.deepEqual(arrays.read(namespace, format), values)

const key = `arib:nvram:${namespace}`
const legacy = JSON.stringify({ 'U:1B': 7, 'S:4B': 'X_BJ' })
records.set(key, legacy)
assert.deepEqual(arrays.read(namespace, 'U:1B,S:4B'), [7, 'X_BJ'])
assert.deepEqual(arrays.read(namespace, 'U:1B'), [7])
assert.equal(records.get(key), legacy)
assert.equal(arrays.read(namespace, 'U:1B,U:1B'), null)
records.set(key, '{invalid')
assert.equal(arrays.read(namespace, 'U:1B'), null)
records.set(key, JSON.stringify([999]))
assert.equal(arrays.read(namespace, 'U:1B'), null)
const blocked = createPersistentArrayStorage({
  getItem() { throw new DOMException('Unavailable', 'SecurityError') },
  setItem() { throw new DOMException('Full', 'QuotaExceededError') },
})
assert.equal(blocked.read(namespace, 'U:1B'), null)
assert.equal(Number.isNaN(blocked.write(namespace, 'U:1B', [1])), true)
