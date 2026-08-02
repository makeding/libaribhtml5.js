import assert from 'node:assert/strict'
import { register } from 'node:module'

register(new URL('./helpers/test-typescript-resolver.mjs', import.meta.url))

class FakeEventTarget {
  listeners = new Map()

  addEventListener(type, listener) {
    const registered = this.listeners.get(type) ?? new Set()
    registered.add(listener)
    this.listeners.set(type, registered)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size ?? 0
  }
}

class FakeStyle {
  values = new Map()
  priorities = new Map()

  setProperty(property, value, priority = '') {
    this.values.set(property, String(value))
    this.priorities.set(property, String(priority))
  }

  removeProperty(property) {
    this.values.delete(property)
    this.priorities.delete(property)
  }
}

class FakeResizeObserver {
  static instances = []

  disconnected = false
  observed = []

  constructor(callback) {
    this.callback = callback
    FakeResizeObserver.instances.push(this)
  }

  observe(element) {
    this.observed.push(element)
  }

  disconnect() {
    this.disconnected = true
  }
}

globalThis.ResizeObserver = FakeResizeObserver

function createHostPlatform() {
  const ownerWindow = new FakeEventTarget()
  const timers = new Map()
  let nextTimer = 1
  ownerWindow.location = {
    origin: 'https://receiver.example',
    href: 'https://receiver.example/player/index.html',
  }
  ownerWindow.performance = { now: () => 1000 }
  ownerWindow.alert = () => {}
  ownerWindow.setTimeout = (callback, delay = 0) => {
    const id = nextTimer++
    timers.set(id, { callback, delay })
    return id
  }
  ownerWindow.clearTimeout = id => timers.delete(id)

  const posted = []
  const contentWindow = {
    location: {
      href: 'about:blank',
      origin: 'null',
    },
    postMessage(message, origin) {
      posted.push({ message, origin })
    },
    document: {
      dispatchEvent() {},
    },
  }
  const iframe = new FakeEventTarget()
  iframe.ownerDocument = { defaultView: ownerWindow }
  iframe.contentWindow = contentWindow
  iframe.style = new FakeStyle()
  iframe.src = 'about:blank'
  iframe.inert = false
  iframe.tabIndex = 0

  const viewport = {
    clientWidth: 1920,
    clientHeight: 1080,
    style: {},
  }

  return { ownerWindow, timers, posted, contentWindow, iframe, viewport }
}

const { AribReceiverHost } = await import('../src/receiver-host.ts')

const platform = createHostPlatform()
const lifecycle = []
const statuses = []
const urls = []
const subscriptions = []
const host = new AribReceiverHost({
  iframe: platform.iframe,
  viewport: platform.viewport,
  onLifecycle: event => lifecycle.push(event),
  onStatus: status => statuses.push(status),
  onUrlChange: url => urls.push(url),
  onCaptionSubscription: subscription => subscriptions.push(subscription),
})

assert.equal(platform.ownerWindow.listenerCount('message'), 1)
assert.equal(platform.iframe.listenerCount('load'), 1)
assert.equal(FakeResizeObserver.instances.at(-1).observed[0], platform.viewport)

host.setCaptionTracks([56, 57, 56])
host.setApplicationInformation({
  type: 'ARIB-HTML5',
  organizationId: 1,
  applicationId: 2,
})
host.setApplicationInputActive(true)
host.setProgramInfo({ service_id: 101, event_id: 7 })
for (let sequence = 0; sequence < 65; sequence += 1) {
  host.emitStreamEvent({ message_id: sequence })
}
assert.deepEqual(platform.posted, [], 'pre-install state must be replayed, not posted early')

platform.ownerWindow.dispatch('message', {
  origin: 'https://outside.example',
  data: {
    type: 'arib-runtime',
    runtimeId: 'outside-runtime',
    event: 'installed',
  },
})
assert.deepEqual(platform.posted, [], 'cross-origin runtime messages must be ignored')

platform.ownerWindow.dispatch('message', {
  origin: 'https://receiver.example',
  data: {
    type: 'arib-runtime',
    runtimeId: 'runtime-1',
    event: 'installed',
    url: 'https://receiver.example/data-broadcast/app/index.html',
  },
})

const replayed = platform.posted.map(entry => entry.message)
assert.deepEqual(replayed.slice(0, 4).map(message => message.event), [
  'caption-tracks',
  'application-information',
  'receiver-input-state',
  'program-info',
])
assert.deepEqual(replayed[0].componentTags, [56, 57])
assert.equal(replayed[1].value.organizationId, 1)
assert.equal(replayed[2].active, true)
assert.equal(replayed[3].value.event_id, 7)
assert.equal(replayed.length, 68, 'installed must replay four snapshots and the bounded backlog')
assert.equal(replayed[4].event, 'stream-event')
assert.equal(replayed[4].value.message_id, 1, 'the oldest of 65 events must be evicted')
assert.equal(replayed.at(-1).value.message_id, 64)
assert.ok(replayed.every(message => message.runtimeId === 'runtime-1'))
assert.equal(lifecycle.at(-1).type, 'installed')
assert.equal(urls.at(-1), 'https://receiver.example/data-broadcast/app/index.html')

const postedAfterInstall = platform.posted.length
host.emitStreamEvent({ message_id: 65 })
assert.equal(platform.posted.length, postedAfterInstall + 1)
assert.equal(platform.posted.at(-1).message.event, 'stream-event')

platform.ownerWindow.dispatch('message', {
  origin: 'https://receiver.example',
  data: {
    type: 'arib-runtime',
    runtimeId: 'stale-runtime',
    event: 'caption-subscription',
    componentTags: [99],
  },
})
assert.deepEqual(subscriptions, [], 'stale runtime messages must be ignored')
platform.ownerWindow.dispatch('message', {
  origin: 'https://receiver.example',
  data: {
    type: 'arib-runtime',
    runtimeId: 'runtime-1',
    event: 'caption-subscription',
    componentTags: [56, '56', 57],
  },
})
assert.deepEqual(subscriptions.at(-1), { componentTags: [56, 57] })

platform.ownerWindow.dispatch('message', {
  origin: 'https://receiver.example',
  data: {
    type: 'arib-runtime',
    runtimeId: 'runtime-1',
    event: 'unloading',
    url: 'https://receiver.example/data-broadcast/app/next.html',
  },
})
assert.deepEqual(subscriptions.at(-1), { componentTags: [] })
assert.equal(lifecycle.at(-1).type, 'navigating')
assert.equal(platform.timers.size, 1, 'unloading must arm the next-document watchdog')

host.setCaptionTracks([60])
host.emitStreamEvent({ message_id: 100 })
const beforeReinstall = platform.posted.length
platform.ownerWindow.dispatch('message', {
  origin: 'https://receiver.example',
  data: {
    type: 'arib-runtime',
    runtimeId: 'runtime-2',
    event: 'installed',
    url: 'https://receiver.example/data-broadcast/app/next.html',
  },
})
assert.equal(platform.timers.size, 0, 'installed must clear the navigation watchdog')
const secondReplay = platform.posted.slice(beforeReinstall).map(entry => entry.message)
assert.deepEqual(secondReplay.slice(0, 4).map(message => message.event), [
  'caption-tracks',
  'application-information',
  'receiver-input-state',
  'program-info',
])
assert.deepEqual(secondReplay[0].componentTags, [60])
assert.equal(secondReplay[4].event, 'stream-event')
assert.equal(secondReplay[4].value.message_id, 100)
assert.ok(secondReplay.every(message => message.runtimeId === 'runtime-2'))

const beforeDestroy = platform.posted.length
host.destroy()
assert.equal(platform.ownerWindow.listenerCount('message'), 0)
assert.equal(platform.iframe.listenerCount('load'), 0)
assert.equal(FakeResizeObserver.instances.at(-1).disconnected, true)
platform.ownerWindow.dispatch('message', {
  origin: 'https://receiver.example',
  data: { type: 'arib-runtime', runtimeId: 'runtime-3', event: 'installed' },
})
host.emitStreamEvent({ message_id: 200 })
assert.equal(platform.posted.length, beforeDestroy)

const noWatchdogPlatform = createHostPlatform()
const noWatchdogHost = new AribReceiverHost({
  iframe: noWatchdogPlatform.iframe,
  viewport: noWatchdogPlatform.viewport,
  applicationLoadTimeoutMs: 0,
})
noWatchdogHost.loadApplication('/data-broadcast/app/index.html')
assert.equal(noWatchdogPlatform.timers.size, 0)
noWatchdogHost.destroy()

console.log('receiver session characterization tests passed')
