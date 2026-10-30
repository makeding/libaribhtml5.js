import assert from 'node:assert/strict'
import vm from 'node:vm'
import {
  configureTvReceiverIframe,
  dispatchReceiverKey,
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
const messages = []
const listeners = []
const parent = {}
const document = {
  activeElement,
  createElement() { return {textContent: '', remove() {}} },
  documentElement: {appendChild(script) { vm.runInContext(script.textContent, context) }},
}
const childWindow = {
  KeyboardEvent: ChildKeyboardEvent, document, parent,
  location: {origin: 'https://receiver.example'},
  addEventListener(type, listener) {
    assert.equal(type, 'message')
    listeners.push(listener)
  },
  postMessage(data, origin) {
    assert.equal(origin, this.location.origin)
    messages.push({data, source: parent, origin})
  },
}
childWindow.window = childWindow
const context = vm.createContext(childWindow)
function flushKeys() {
  for (const message of messages.splice(0)) {
    for (const listener of listeners) listener(message)
  }
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

assert.equal(dispatchReceiverKey(iframe, 40), true)
assert.deepEqual(received, [])
flushKeys()
assert.deepEqual(received.map(event => event.type), ['keydown', 'keyup'])
assert.ok(received.every(event => event instanceof ChildKeyboardEvent))
assert.ok(received.every(event => event.view === vm.runInContext('window', context)))
assert.deepEqual(received.map(event => event.keyCode), [40, 40])
assert.deepEqual(received.map(event => event.which), [40, 40])

assert.equal(dispatchReceiverKey({ ...iframe, contentWindow: null }, 40), false)
assert.equal(dispatchReceiverKey(iframe, 40.5), false)

assert.equal(dispatchReceiverKey(iframe, 13), true)
assert.equal(listeners.length, 1)
flushKeys()
assert.deepEqual(received.slice(-2).map(event => event.keyCode), [13, 13])
const count = received.length
listeners[0]({data: {type: 'arib-receiver-key', code: 13, token: 'wrong'}, source: parent, origin: childWindow.location.origin})
assert.equal(received.length, count)
console.log('TV receiver input contracts passed')
