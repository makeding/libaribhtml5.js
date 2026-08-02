import assert from 'node:assert/strict'

import { createBroadcastResourceCache } from '../../src/runtime/resources.ts'

const pending = []
const released = []
const resourceStore = {
  store(url, { signal }) {
    return new Promise((resolve, reject) => {
      pending.push({ url, signal, resolve, reject })
    })
  },
  release(url) {
    released.push(url)
  },
}
const target = {
  AbortController,
  queueMicrotask,
}
const events = []
const cache = createBroadcastResourceCache(
  target,
  path => new URL(path, 'https://receiver.example/data-broadcast/app/index.html'),
  resourceStore,
)
const listener = (path, event) => events.push([path, event])

assert.equal(cache.store('./font.woff', listener), true)
assert.deepEqual(events, [])
pending.shift().resolve()
await new Promise(resolve => setTimeout(resolve, 0))
assert.deepEqual(events, [['./font.woff', 'store_finished']])

cache.change('./font.woff', 'updated')
assert.equal(pending.length, 1)
pending.shift().resolve()
await new Promise(resolve => setTimeout(resolve, 0))
assert.deepEqual(events.at(-1), ['./font.woff', 'updated'])

cache.change('./font.woff', 'deleted')
await new Promise(resolve => setTimeout(resolve, 0))
assert.deepEqual(events.at(-1), ['./font.woff', 'deleted'])
assert.deepEqual(released, ['https://receiver.example/data-broadcast/app/font.woff'])

cache.store('./slow.bin', listener)
const slow = pending.shift()
cache.release('./slow.bin')
assert.equal(slow.signal.aborted, true)
