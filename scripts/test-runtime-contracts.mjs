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
  createRuntimeBootstrap,
  prepareBroadcastHtml,
  prepareBroadcastStylesheet,
} from '../src/broadcast-document.ts'
import { dispatchProgramGuideRequest } from '../src/program-guide.ts'
import {
  createReceiverSystemInformation,
  readReceiverInformationArray,
  RECEIVER_SYSTEM_IDENTITY,
  synchronizeReceiverCompatibilityStorage,
} from '../src/runtime/system-information.ts'
import { cloneProgramInfo } from '../src/program-info.ts'
import {
  DEFAULT_RECEIVER_DEVICE_IDENTIFIER,
  resolveReceiverDeviceIdentifier,
} from '../src/device-identifier.ts'
import { BroadcastVfsSession } from '../src/service-worker-vfs.ts'
import { runtimeEventMatchesSelector } from '../src/runtime/stream-event.ts'
import { resolveBroadcastMediaSlot } from '../src/runtime/media-slot.ts'
import { BehindIframeMediaPlaneAdapter } from '../src/media-plane.ts'
import { makeIframePointerTransparent } from '../src/iframe-input.ts'

const mediaRect = (left, top, width, height) => ({
  x: left,
  y: top,
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
})
const mediaDocument = { body: {}, documentElement: {} }
const mediaStyle = (values = {}) => ({
  getPropertyValue(property) { return values[property] ?? '' },
})
const mediaElement = ({ rect, parent = null, attributes = [], style = {} }) => ({
  ownerDocument: mediaDocument,
  parentElement: parent,
  children: [],
  firstElementChild: null,
  style: mediaStyle(style),
  hasAttribute(name) { return attributes.includes(name) },
  getBoundingClientRect() { return rect },
})

const mediaWrapper = mediaElement({ rect: mediaRect(216, 134, 1440, 810) })
const defaultSizedMediaObject = mediaElement({
  rect: mediaRect(216, 134, 300, 150),
  parent: mediaWrapper,
})
mediaWrapper.children = [defaultSizedMediaObject]
mediaWrapper.firstElementChild = defaultSizedMediaObject
assert.equal(resolveBroadcastMediaSlot(defaultSizedMediaObject).element, mediaWrapper)
assert.deepEqual(resolveBroadcastMediaSlot(defaultSizedMediaObject).rect, mediaRect(216, 134, 1440, 810))

const explicitlySizedMediaObject = mediaElement({
  rect: mediaRect(216, 134, 640, 360),
  parent: mediaWrapper,
  attributes: ['width', 'height'],
})
mediaWrapper.children = [explicitlySizedMediaObject]
mediaWrapper.firstElementChild = explicitlySizedMediaObject
assert.equal(resolveBroadcastMediaSlot(explicitlySizedMediaObject).element, explicitlySizedMediaObject)

const mediaWrapperWithOverlay = mediaElement({ rect: mediaRect(216, 134, 1440, 810) })
const overlaidDefaultObject = mediaElement({
  rect: mediaRect(216, 134, 300, 150),
  parent: mediaWrapperWithOverlay,
})
const mediaOverlay = mediaElement({ rect: mediaRect(216, 134, 1440, 810) })
mediaWrapperWithOverlay.children = [overlaidDefaultObject, mediaOverlay]
mediaWrapperWithOverlay.firstElementChild = overlaidDefaultObject
assert.equal(resolveBroadcastMediaSlot(overlaidDefaultObject).element, overlaidDefaultObject)

const externalSurface = { style: {} }
const externalAdapter = new BehindIframeMediaPlaneAdapter({ surface: externalSurface })
const externalPlane = {
  slotId: 'test',
  visible: true,
  x: 480,
  y: 54,
  width: 2880,
  height: 1620,
  screenWidth: 3840,
  screenHeight: 2160,
  layer: { documentOrder: 0, stackingPath: [], externalPlacement: 'behind-application' },
}
externalAdapter.mountMediaPlane(null, externalPlane)
assert.equal(externalSurface.style.zIndex, '0')
externalAdapter.updateMediaPlane(null, {
  ...externalPlane,
  layer: { ...externalPlane.layer, externalPlacement: 'above-application' },
})
assert.equal(externalSurface.style.zIndex, '2')

const receiverIframe = {
  style: {},
  tabIndex: 0,
}
makeIframePointerTransparent(receiverIframe)
assert.equal(receiverIframe.style.pointerEvents, 'none')
assert.equal(receiverIframe.tabIndex, -1)

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
const regionalSystemInformation = createReceiverSystemInformation(
  'https://receiver.example/data-broadcast/',
  { zipcode: '1234567', prefecture: 13, regioncode: 0x1c7 },
)
assert.deepEqual(
  readReceiverInformationArray(
    'receiverinfo/profile',
    'zipcode,prefecture,regioncode,unsupported',
    regionalSystemInformation,
  ),
  ['1234567', 13, 0x1c7, null],
)
const receiverCompatibilityStorage = new Map()
const receiverStorage = {
  setItem(key, value) { receiverCompatibilityStorage.set(key, String(value)) },
  removeItem(key) { receiverCompatibilityStorage.delete(key) },
}
synchronizeReceiverCompatibilityStorage(receiverStorage, regionalSystemInformation)
assert.equal(receiverCompatibilityStorage.get('_zipcode'), '1234567')
synchronizeReceiverCompatibilityStorage(
  receiverStorage,
  createReceiverSystemInformation('https://receiver.example/data-broadcast/', {
    zipcode: '210-0015',
  }),
)
assert.equal(receiverCompatibilityStorage.get('_zipcode'), '2100015')
synchronizeReceiverCompatibilityStorage(
  receiverStorage,
  createReceiverSystemInformation('https://receiver.example/data-broadcast/', {
    zipcode: 'invalid',
  }),
)
assert.equal(receiverCompatibilityStorage.has('_zipcode'), false)
assert.equal(
  readReceiverInformationArray('application/private', 'zipcode', regionalSystemInformation),
  null,
)
const streamEvent = {
  source: {
    original_network_id: 4,
    tlv_stream_id: 11,
    service_id: 101,
    event_message_tag: 50,
  },
  message_group_id: 1,
  message_id: 176,
  message_version: 7,
  private_data_byte: '\u0001\u00ff',
}
assert.equal(runtimeEventMatchesSelector(streamEvent, {
  source: { event_message_tag: 50 },
  message_id: 176,
}), true)
assert.equal(runtimeEventMatchesSelector(streamEvent, {
  source: { original_network_id: 4, tlv_stream_id: 11, service_id: 101 },
  message_group_id: 1,
  message_id: 176,
  message_version: 7,
}), true)
assert.equal(runtimeEventMatchesSelector(streamEvent, {
  source: { event_message_tag: 40 },
  message_id: 176,
}), false)
assert.equal(runtimeEventMatchesSelector(streamEvent, {
  source: { event_message_tag: 50 },
  message_version: 8,
}), true)

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
  resolveBroadcastUrl('/bsfuji4k/60/001/top/index.html', base, root).pathname,
  '/data-broadcast/bsfuji4k/60/001/top/index.html',
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

const runtimeBootstrap = createRuntimeBootstrap('/receiver-vfs/')
const bootstrapSource = runtimeBootstrap.replace(/^<script>|<\/script>$/g, '')
const scheduledBootstrap = []
const bootstrapParent = {}
const bootstrapContext = {
  console,
  location: { origin: 'https://receiver.example' },
  navigator: {},
  parent: bootstrapParent,
  setTimeout(callback) {
    scheduledBootstrap.push(callback)
  },
  URL,
}
bootstrapContext.window = bootstrapContext
vm.runInNewContext(bootstrapSource, bootstrapContext)
assert.equal(
  bootstrapContext.navigator.receiverDevice.getSystemInformation().baseurl,
  'https://receiver.example/receiver-vfs/',
)
assert.equal(scheduledBootstrap.length, 1)
let installedBootstrapTarget
bootstrapParent.__ARIB_HTML5_INSTALL__ = target => {
  installedBootstrapTarget = target
}
scheduledBootstrap.shift()()
assert.equal(installedBootstrapTarget.navigator, bootstrapContext.navigator)
assert.equal(installedBootstrapTarget.location.origin, bootstrapContext.location.origin)
assert.equal(scheduledBootstrap.length, 0)
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

// dispose() waits for an active write but prevents queued resources from
// repopulating a backend after its owner resets the VFS.
let releaseActiveWrite
let activeWriteStarted
const activeWriteGate = new Promise(resolve => { releaseActiveWrite = resolve })
const activeWriteSignal = new Promise(resolve => { activeWriteStarted = resolve })
const disposedFiles = new Map()
const disposableSession = new BroadcastVfsSession({
  async begin() {
    disposedFiles.clear()
  },
  async put(resource) {
    activeWriteStarted()
    await activeWriteGate
    disposedFiles.set(resource.path, Uint8Array.from(resource.data))
  },
  async canRead(path) {
    return disposedFiles.has(path)
  },
}, {
  schedule: task => queueMicrotask(task),
})
await disposableSession.beginSession()
disposableSession.enqueue({ path: 'active.bin', data: new Uint8Array([1]) })
disposableSession.enqueue({ path: 'queued.bin', data: new Uint8Array([2]) })
await activeWriteSignal
const disposingSession = disposableSession.dispose()
releaseActiveWrite()
await disposingSession
assert.equal(disposedFiles.has('active.bin'), true)
assert.equal(disposedFiles.has('queued.bin'), false)
assert.throws(
  () => disposableSession.enqueue({ path: 'late.bin', data: new Uint8Array([3]) }),
  /disposed/,
)
await assert.rejects(disposableSession.beginSession(), /disposed/)

console.log('runtime URL and resource lifecycle contracts passed')
