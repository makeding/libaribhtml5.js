import assert from 'node:assert/strict'

export function rect(left, top, width, height) {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  }
}

export class FakeStyleDeclaration {
  #values = new Map()
  #priorities = new Map()

  writes = 0

  constructor(values = {}) {
    for (const [property, value] of Object.entries(values)) {
      if (typeof value === 'object' && value !== null) {
        this.setInitial(property, value.value ?? '', value.priority ?? '')
      } else {
        this.setInitial(property, value)
      }
    }
  }

  setInitial(property, value, priority = '') {
    this.#values.set(property, String(value))
    this.#priorities.set(property, String(priority))
  }

  getPropertyValue(property) {
    return this.#values.get(property) ?? ''
  }

  getPropertyPriority(property) {
    return this.#priorities.get(property) ?? ''
  }

  setProperty(property, value, priority = '') {
    this.#values.set(property, String(value))
    this.#priorities.set(property, String(priority))
    this.writes += 1
  }

  removeProperty(property) {
    const previous = this.getPropertyValue(property)
    this.#values.delete(property)
    this.#priorities.delete(property)
    this.writes += 1
    return previous
  }
}

export class FakeElement {
  constructor({
    tagName = 'div',
    id = '',
    box = rect(0, 0, 0, 0),
    style = {},
    computed = {},
    attributes = [],
  } = {}) {
    this.tagName = tagName.toUpperCase()
    this.id = id
    this.box = box
    this.style = new FakeStyleDeclaration(style)
    this.computed = {
      position: 'static',
      zIndex: 'auto',
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      transform: 'none',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      backgroundImage: 'none',
      ...computed,
    }
    this.attributes = new Set(attributes)
    this.children = []
    this.firstElementChild = null
    this.parentElement = null
    this.ownerDocument = null
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this
      child.ownerDocument = this.ownerDocument
      this.children.push(child)
    }
    this.firstElementChild = this.children[0] ?? null
    this.ownerDocument?.adopt(this)
  }

  contains(candidate) {
    if (candidate === this) return true
    return this.children.some(child => child.contains(candidate))
  }

  hasAttribute(name) {
    return this.attributes.has(name)
  }

  getBoundingClientRect() {
    return this.box
  }

  querySelector() {
    return null
  }
}

export class FakeDocument {
  constructor() {
    this.documentElement = new FakeElement({
      tagName: 'html',
      box: rect(0, 0, 3840, 2160),
    })
    this.body = new FakeElement({
      tagName: 'body',
      box: rect(0, 0, 3840, 2160),
    })
    this.documentElement.ownerDocument = this
    this.body.ownerDocument = this
    this.documentElement.append(this.body)
    this.readyState = 'complete'
    this.animations = []
    this.listeners = new Map()
  }

  adopt(root) {
    root.ownerDocument = this
    for (const child of root.children) this.adopt(child)
  }

  querySelectorAll(selector) {
    if (selector === 'body *') return descendants(this.body)
    if (selector === '*') return [this.documentElement, this.body, ...descendants(this.body)]
    assert.fail(`fake DOM does not implement selector ${selector}`)
  }

  querySelector(selector) {
    if (selector === 'meta[name="viewport"]') return null
    if (selector.includes('object[type="video/x-arib2-broadcast"]')) {
      return descendants(this.body).find(element => element.tagName === 'OBJECT') ?? null
    }
    assert.fail(`fake DOM does not implement selector ${selector}`)
  }

  getAnimations() {
    return this.animations
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function descendants(root) {
  return root.children.flatMap(child => [child, ...descendants(child)])
}

class FakeObserver {
  constructor(callback) {
    this.callback = callback
    this.observed = new Set()
    this.disconnected = false
  }

  observe(element) {
    this.observed.add(element)
  }

  unobserve(element) {
    this.observed.delete(element)
  }

  disconnect() {
    this.observed.clear()
    this.disconnected = true
  }

  trigger(records = []) {
    this.callback(records, this)
  }
}

export function createFakeMediaPlaneWindow() {
  const document = new FakeDocument()
  const frames = new Map()
  const listeners = new Map()
  const mutationObservers = []
  const resizeObservers = []
  let nextFrame = 1

  class FakeMutationObserver extends FakeObserver {
    constructor(callback) {
      super(callback)
      mutationObservers.push(this)
    }
  }

  class FakeResizeObserver extends FakeObserver {
    constructor(callback) {
      super(callback)
      resizeObservers.push(this)
    }
  }

  const target = {
    document,
    Element: FakeElement,
    MutationObserver: FakeMutationObserver,
    ResizeObserver: FakeResizeObserver,
    mutationObservers,
    resizeObservers,
    getComputedStyle(element) {
      const inline = property => element.style.getPropertyValue(property)
      return {
        ...element.computed,
        opacity: inline('opacity') || element.computed.opacity,
        backgroundColor: inline('background-color') || element.computed.backgroundColor,
        backgroundImage: inline('background-image') || element.computed.backgroundImage,
      }
    },
    requestAnimationFrame(callback) {
      const id = nextFrame++
      frames.set(id, callback)
      return id
    },
    cancelAnimationFrame(id) {
      frames.delete(id)
    },
    flushAnimationFrames(timestamp = 0) {
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback(timestamp)
    },
    pendingAnimationFrames() {
      return frames.size
    },
    addEventListener(type, listener) {
      const registered = listeners.get(type) ?? new Set()
      registered.add(listener)
      listeners.set(type, registered)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) ?? []) listener(event)
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0
    },
  }

  return { target, document }
}

export function append(parent, ...children) {
  parent.append(...children)
  return children.length === 1 ? children[0] : children
}

export function inlineStyleSnapshot(element, ...properties) {
  return Object.fromEntries(properties.map(property => [property, {
    value: element.style.getPropertyValue(property),
    priority: element.style.getPropertyPriority(property),
  }]))
}
