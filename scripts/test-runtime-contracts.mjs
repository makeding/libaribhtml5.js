import assert from 'node:assert/strict'
import packageMetadata from '../package.json' with { type: 'json' }
import vm from 'node:vm'

import {
  deriveBroadcastRootUrl,
  normalizeBroadcastBaseUrl,
  resolveBroadcastUrl,
} from '../src/broadcast-url.ts'
import { createBroadcastResourceCache } from '../src/runtime/resources.ts'
import {
  prepareBroadcastHtml,
  prepareBroadcastStylesheet,
} from '../src/broadcast-document.ts'
import { dispatchProgramGuideRequest } from '../src/program-guide.ts'
import {
  createReceiverSystemInformation,
  RECEIVER_SYSTEM_IDENTITY,
} from '../src/runtime/system-information.ts'
import { cloneProgramInfo } from '../src/program-info.ts'
import {
  DEFAULT_RECEIVER_DEVICE_IDENTIFIER,
  resolveReceiverDeviceIdentifier,
} from '../src/device-identifier.ts'
import { BroadcastVfsSession } from '../src/service-worker-vfs.ts'

const origin = 'https://receiver.example/player/index.html'
assert.deepEqual(RECEIVER_SYSTEM_IDENTITY, {
  browsername: packageMetadata.name,
  browserversion: packageMetadata.version,
  makerid: packageMetadata.author.name,
  modelname: packageMetadata.aribReceiver.modelName,
})
assert.deepEqual(createReceiverSystemInformation('https://receiver.example/data-broadcast/', {
  makerid: 'receiver-vendor',
  baseurl: 'https://wrong.example/',
  decoder: 'native',
}), {
  browsername: packageMetadata.name,
  browserversion: packageMetadata.version,
  makerid: 'receiver-vendor',
  modelname: packageMetadata.aribReceiver.modelName,
  decoder: 'native',
  baseurl: 'https://receiver.example/data-broadcast/',
})

const programStart = new Date('2026-07-31T12:00:00Z')
const program = cloneProgramInfo({
  service_id: 101,
  event_id: 42,
  start_time: programStart,
  duration: 30 * 60 * 1000,
})
assert.notEqual(program.start_time, programStart)
assert.equal(program.start_time.getTime(), programStart.getTime())
const iframeDate = vm.runInNewContext('new Date("2026-07-31T12:00:00Z")')
assert.equal(cloneProgramInfo({ start_time: iframeDate }).start_time.getTime(), programStart.getTime())
assert.throws(() => cloneProgramInfo({ start_time: '2026-07-31T12:00:00Z' }), /valid Date/)
assert.throws(() => cloneProgramInfo({ duration: -1 }), /millisecond duration/)
assert.equal(await resolveReceiverDeviceIdentifier(0), DEFAULT_RECEIVER_DEVICE_IDENTIFIER)
assert.equal(await resolveReceiverDeviceIdentifier(7, kind => `receiver-${kind}`), 'receiver-7')
assert.equal(await resolveReceiverDeviceIdentifier(9, () => null), '')
const base = normalizeBroadcastBaseUrl(undefined, origin)
assert.equal(base.href, 'https://receiver.example/data-broadcast/')
const root = deriveBroadcastRootUrl(
  'https://receiver.example/data-broadcast/bsfuji4k/40/0000/html/index.html',
  base,
)
assert.equal(root.href, 'https://receiver.example/data-broadcast/bsfuji4k/')
assert.equal(
  resolveBroadcastUrl('/60/002/caption/source/index.html', base, root).pathname,
  '/data-broadcast/bsfuji4k/60/002/caption/source/index.html',
)
assert.equal(
  resolveBroadcastUrl('/sh4/60/001/index.html?x=1#top', base).href,
  'https://receiver.example/data-broadcast/sh4/60/001/index.html?x=1#top',
)
assert.equal(
  resolveBroadcastUrl('/data-broadcast/sh4/index.html', base).pathname,
  '/data-broadcast/sh4/index.html',
)

const preparedHtml = prepareBroadcastHtml(
  '<html><head><title>x</title></head><body>' +
  '<object type="video/x-arib2-broadcast" data=""></object>' +
  '<audio src="romsound://9"></audio><script src="/sh4/app.js"></script></body></html>',
  { bootstrap: '<script>install()</script>' },
)
assert.match(preparedHtml, /<head><script>install\(\)<\/script>/)
assert.match(preparedHtml, /data-arib-type="video\/x-arib2-broadcast"/)
assert.match(preparedHtml, /data-arib-romsound="romsound:\/\/9"/)
assert.match(preparedHtml, /src="\/data-broadcast\/sh4\/app\.js"/)
assert.equal(
  prepareBroadcastStylesheet('a{background:url("/sh4/a.png")} @import "/40/base.css";'),
  'a{background:url("/data-broadcast/sh4/a.png")} @import "/data-broadcast/40/base.css";',
)

const guideRequest = {
  destination: 'program-detail',
  state: 'future',
  program: { service_id: 101, event_id: 42 },
}
const guideUnavailable = []
assert.equal(await dispatchProgramGuideRequest(
  guideRequest,
  undefined,
  event => guideUnavailable.push(event),
), false)
assert.equal(guideUnavailable[0].reason, 'unsupported')

let openedGuide
assert.equal(await dispatchProgramGuideRequest(guideRequest, request => {
  openedGuide = request
  request.program.event_id = 99
}), true)
assert.equal(openedGuide.state, 'future')
assert.equal(guideRequest.program.event_id, 42)

assert.equal(await dispatchProgramGuideRequest(
  guideRequest,
  () => false,
  event => guideUnavailable.push(event),
), false)
assert.equal(guideUnavailable.at(-1).reason, 'rejected')

assert.equal(await dispatchProgramGuideRequest(
  guideRequest,
  () => { throw new Error('native bridge unavailable') },
  event => guideUnavailable.push(event),
), false)
assert.equal(guideUnavailable.at(-1).reason, 'error')

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

const vfsFiles = new Map()
let vfsBegins = 0
const vfsBackend = {
  async begin() {
    vfsBegins += 1
    vfsFiles.clear()
  },
  async put(resource) {
    vfsFiles.set(resource.path, Uint8Array.from(resource.data))
  },
  async canRead(path) {
    return vfsFiles.has(path)
  },
}
const vfsSession = new BroadcastVfsSession(vfsBackend, {
  schedule: task => queueMicrotask(task),
})
await vfsSession.beginSession()
const callbackLifetimeData = new Uint8Array([1, 2, 3])
const revision = vfsSession.enqueue({
  path: '/carousel/index.html',
  data: callbackLifetimeData,
})
callbackLifetimeData[0] = 99
await vfsSession.waitFor(revision)
assert.deepEqual([...vfsFiles.get('carousel/index.html')], [1, 2, 3])

// Simulate Worker memory reclamation. ensure() owns the ordered mirror replay.
vfsFiles.clear()
await vfsSession.ensure('carousel/index.html', revision)
assert.equal(vfsBegins, 2)
assert.deepEqual([...vfsFiles.get('carousel/index.html')], [1, 2, 3])

console.log('runtime URL and resource lifecycle contracts passed')
