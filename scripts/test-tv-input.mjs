import assert from 'node:assert/strict'
import {
  configureTvReceiverIframe,
  dispatchTvReceiverKey,
} from '../src/tv-input.ts'

const styleWrites = []
const received = []
class ChildKeyboardEvent {
  constructor(type, init) {
    this.type = type
    Object.assign(this, init)
  }
}
const activeElement = {
  dispatchEvent(event) {
    received.push(event)
    return true
  },
}
const childWindow = {
  KeyboardEvent: ChildKeyboardEvent,
  document: { activeElement },
}
const iframe = {
  contentWindow: childWindow,
  inert: true,
  style: {
    setProperty(...args) {
      styleWrites.push(args)
    },
  },
  tabIndex: 0,
}

configureTvReceiverIframe(iframe)
assert.equal(iframe.inert, false)
assert.equal(iframe.tabIndex, -1)
assert.deepEqual(styleWrites, [['pointer-events', 'none', 'important']])

assert.equal(dispatchTvReceiverKey(iframe, 40), true)
assert.deepEqual(received.map(event => event.type), ['keydown', 'keyup'])
assert.ok(received.every(event => event instanceof ChildKeyboardEvent))
assert.ok(received.every(event => event.view === childWindow))
assert.deepEqual(received.map(event => event.keyCode), [40, 40])
assert.deepEqual(received.map(event => event.which), [40, 40])

assert.equal(dispatchTvReceiverKey({ ...iframe, contentWindow: null }, 40), false)
assert.equal(dispatchTvReceiverKey(iframe, 40.5), false)

console.log('TV receiver input contracts passed')
