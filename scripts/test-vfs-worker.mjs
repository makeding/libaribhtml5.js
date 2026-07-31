import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

import {
  createRuntimeBootstrap,
  prepareBroadcastHtml,
  prepareBroadcastStylesheet,
} from '../src/broadcast-document.ts'

const entries = new Map()
const key = request => typeof request === 'string' ? request : request.url
const cache = {
  async put(request, response) {
    entries.set(key(request), response.clone())
  },
  async match(request) {
    return entries.get(key(request))?.clone()
  },
  async keys() {
    return [...entries.keys()].map(url => new Request(url))
  },
}
const caches = {
  async open() { return cache },
  async delete() {
    const existed = entries.size > 0
    entries.clear()
    return existed
  },
}

const source = (await readFile(
  new URL('../src/browser/arib-vfs-worker.js', import.meta.url),
  'utf8',
)).replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"]\s*/, '')

function createWorker() {
  const listeners = new Map()
  const context = {
    ArrayBuffer,
    caches,
    fetch: async request => new Response(`network: ${request.url}`, { status: 404 }),
    Map,
    Request,
    Response,
    Set,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    URL,
    createRuntimeBootstrap,
    prepareBroadcastHtml,
    prepareBroadcastStylesheet,
    setTimeout,
    self: {
      location: { origin: 'http://127.0.0.1:8000' },
      registration: { scope: 'http://127.0.0.1:8000/data-broadcast/' },
      clients: { async claim() {} },
      async skipWaiting() {},
      addEventListener(type, listener) { listeners.set(type, listener) },
    },
  }
  vm.runInNewContext(source, context)
  return listeners
}

async function message(listeners, data) {
  let reply
  let lifetime = Promise.resolve()
  listeners.get('message')({
    data,
    ports: [{ postMessage(value) { reply = value } }],
    waitUntil(value) { lifetime = Promise.resolve(value) },
  })
  await lifetime
  return reply
}

async function request(listeners, path, method = 'GET') {
  let response
  listeners.get('fetch')({
    request: new Request(`http://127.0.0.1:8000/data-broadcast/${path}`, { method }),
    respondWith(value) { response = Promise.resolve(value) },
  })
  assert.ok(response, 'VFS fetch handler must intercept its scoped URL')
  return response
}

const first = createWorker()
assert.equal((await message(first, {
  type: 'arib-vfs-begin',
  uniqueBasenameFallback: true,
})).ok, true)
const html = new TextEncoder().encode(
  '<html><head></head><body><object type="video/x-arib2-broadcast"></object>' +
  '<script src="/60/app.js"></script><script src="/sh4/61/app.js"></script></body></html>',
)
assert.equal((await message(first, {
  type: 'arib-vfs-put',
  path: 'sh4/index.html',
  contentType: 'text/html; charset=utf-8',
  data: html.buffer,
})).ok, true)
const available = await message(first, {
  type: 'arib-vfs-probe',
  path: 'sh4/index.html',
})
assert.equal(available.ok, true)
assert.equal(available.available, true)

const response = await request(first, 'sh4/index.html')
assert.equal(response.status, 200)
const prepared = await response.text()
assert.match(prepared, /__ARIB_HTML5_INSTALL__/)
assert.match(prepared, /data-arib-type="video\/x-arib2-broadcast"/)
assert.match(prepared, /src="\/data-broadcast\/sh4\/60\/app\.js"/)
assert.match(prepared, /src="\/data-broadcast\/sh4\/61\/app\.js"/)
const head = await request(first, 'sh4/index.html', 'HEAD')
assert.equal(head.status, 200)
assert.equal(await head.text(), '')

// A reclaimed/replaced worker restores the active session from Cache Storage.
const restarted = createWorker()
const restored = await message(restarted, {
  type: 'arib-vfs-probe',
  path: 'sh4/index.html',
})
assert.equal(restored.ok, true)
assert.equal(restored.available, true)
const missing = await message(restarted, {
  type: 'arib-vfs-probe',
  path: 'sh4/missing.html',
})
assert.equal(missing.ok, true)
assert.equal(missing.available, false)

console.log('Service Worker VFS protocol contracts passed')
