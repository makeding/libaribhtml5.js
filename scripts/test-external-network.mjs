import assert from 'node:assert/strict'

import { installExternalNetworkPolicy } from '../src/runtime/external-network.ts'

class FakeProgressEvent {
  constructor(type) {
    this.type = type
  }
}

class FakeRequest {
  constructor(url) {
    this.url = String(url)
  }
}

function createTarget() {
  const xhrCalls = []
  const fetchCalls = []
  const beaconCalls = []

  class FakeXMLHttpRequest {
    listeners = new Map()

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? []
      listeners.push(listener)
      this.listeners.set(type, listeners)
    }

    dispatchEvent(event) {
      for (const listener of this.listeners.get(event.type) ?? []) listener.call(this, event)
      return true
    }

    open(...args) {
      xhrCalls.push(['open', this, ...args])
    }

    send(...args) {
      xhrCalls.push(['send', this, ...args])
    }
  }

  const target = {
    location: {
      href: 'https://receiver.example/data/app/index.html',
      origin: 'https://receiver.example',
    },
    XMLHttpRequest: FakeXMLHttpRequest,
    Request: FakeRequest,
    ProgressEvent: FakeProgressEvent,
    queueMicrotask,
    async fetch(...args) {
      fetchCalls.push(args)
      return { ok: true, input: args[0] }
    },
    navigator: {
      sendBeacon(...args) {
        beaconCalls.push(args)
        return true
      },
    },
  }

  return { target, xhrCalls, fetchCalls, beaconCalls }
}

{
  const { target, xhrCalls, fetchCalls, beaconCalls } = createTarget()
  installExternalNetworkPolicy(target, false)

  const sameOriginXhr = new target.XMLHttpRequest()
  sameOriginXhr.open('GET', '/data/resource.bin', true)
  sameOriginXhr.send('same-origin')
  assert.deepEqual(xhrCalls.map(([method]) => method), ['open', 'send'])

  const externalXhr = new target.XMLHttpRequest()
  let externalErrors = 0
  externalXhr.addEventListener('error', () => externalErrors++)
  externalXhr.open('POST', 'https://communication.example/entry', false)
  externalXhr.send('blocked')
  assert.deepEqual(xhrCalls.map(([method]) => method), ['open', 'send', 'open'])
  assert.equal(externalErrors, 0)
  await new Promise((resolve) => queueMicrotask(resolve))
  assert.equal(externalErrors, 1)

  // Reusing the same XHR for a same-origin URL must clear its blocked state.
  externalXhr.open('GET', 'https://receiver.example/data/next')
  externalXhr.send(null)
  assert.deepEqual(xhrCalls.map(([method]) => method), ['open', 'send', 'open', 'open', 'send'])

  assert.equal((await target.fetch('/data/local')).ok, true)
  assert.equal((await target.fetch(new URL('https://receiver.example/data/url'))).ok, true)
  await assert.rejects(
    target.fetch('https://communication.example/api'),
    { name: 'TypeError', message: 'External network is offline' },
  )
  await assert.rejects(
    target.fetch(new target.Request('http://communication.example/api')),
    { name: 'TypeError', message: 'External network is offline' },
  )
  assert.equal(fetchCalls.length, 2)

  assert.equal(target.navigator.sendBeacon('/data/report', 'local'), true)
  assert.equal(target.navigator.sendBeacon('https://communication.example/report', 'blocked'), false)
  assert.deepEqual(beaconCalls, [['/data/report', 'local']])
}

{
  const { target, xhrCalls, fetchCalls, beaconCalls } = createTarget()
  const originalOpen = target.XMLHttpRequest.prototype.open
  const originalSend = target.XMLHttpRequest.prototype.send
  const originalFetch = target.fetch
  const originalSendBeacon = target.navigator.sendBeacon

  installExternalNetworkPolicy(target, true)

  assert.equal(target.XMLHttpRequest.prototype.open, originalOpen)
  assert.equal(target.XMLHttpRequest.prototype.send, originalSend)
  assert.equal(target.fetch, originalFetch)
  assert.equal(target.navigator.sendBeacon, originalSendBeacon)

  const xhr = new target.XMLHttpRequest()
  xhr.open('GET', 'https://communication.example/data')
  xhr.send()
  await target.fetch('https://communication.example/data')
  assert.equal(target.navigator.sendBeacon('https://communication.example/report'), true)
  assert.deepEqual(xhrCalls.map(([method]) => method), ['open', 'send'])
  assert.equal(fetchCalls.length, 1)
  assert.equal(beaconCalls.length, 1)
}

console.log('external network policy tests passed')
