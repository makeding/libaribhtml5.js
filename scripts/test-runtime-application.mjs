import assert from 'node:assert/strict'
import { register } from 'node:module'

register(new URL('./helpers/test-typescript-resolver.mjs', import.meta.url))

const { RuntimeApplicationController } = await import(
  '../src/runtime/application-controller.ts'
)

class FakeElement {
  constructor(anchor = null) {
    this.anchor = anchor
  }

  closest(selector) {
    assert.equal(selector, 'a[href]')
    return this.anchor
  }
}

function createRuntime({
  href = 'https://receiver.example/data-broadcast/app/index.html',
  application,
  allowExternalNetwork = false,
  resolveRuntimeUrl,
  nhksh,
} = {}) {
  const listeners = new Map()
  const visibility = { value: '', priority: '' }
  const document = {
    documentElement: {
      style: {
        setProperty(property, value, priority) {
          assert.equal(property, 'visibility')
          visibility.value = value
          visibility.priority = priority
        },
      },
    },
    addEventListener(type, listener) {
      const registered = listeners.get(type) ?? new Set()
      registered.add(listener)
      listeners.set(type, registered)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    dispatch(type, event) {
      for (const listener of listeners.get(type) ?? []) listener(event)
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0
    },
  }
  const target = {
    document,
    navigator: {},
    location: new URL(href),
    Element: FakeElement,
    ...(nhksh ? { nhksh } : {}),
  }
  const messages = []
  const controller = new RuntimeApplicationController({
    target,
    broadcastBaseUrl: 'https://receiver.example/data-broadcast/',
    resolveRuntimeUrl: resolveRuntimeUrl ?? (value => new URL(String(value), target.location.href)),
    allowExternalNetwork,
    application,
    postRuntime: (event, detail = {}) => messages.push({ event, detail }),
  })
  return { controller, target, document, visibility, messages }
}

{
  const runtime = createRuntime({
    application: {
      type: 'html5',
      organizationId: 10,
      applicationId: 20,
      controlCode: 'present',
      autostartPriority: 30,
    },
  })
  const owner = runtime.target.navigator.applicationManager.getOwnerApplication()
  assert.equal(owner.type, 'html5')
  assert.equal(owner.organization_id, 10)
  assert.equal(owner.application_id, 20)
  assert.equal(owner.control_code, 'present')
  assert.equal(owner.autostart_priority, 30)
  assert.deepEqual(
    {
      RED: owner.keySet.RED,
      GREEN: owner.keySet.GREEN,
      YELLOW: owner.keySet.YELLOW,
      BLUE: owner.keySet.BLUE,
      NAVIGATION: owner.keySet.NAVIGATION,
      DBUTTON: owner.keySet.DBUTTON,
    },
    { RED: 1, GREEN: 2, YELLOW: 4, BLUE: 8, NAVIGATION: 16, DBUTTON: 32 },
  )
  assert.equal(owner.keySet.setValue(0x31), true)
  assert.equal(owner.keySet.value, 0x31)
  assert.deepEqual(runtime.visibility, { value: '', priority: '' })

  assert.equal(owner.hide(), true)
  assert.deepEqual(runtime.visibility, { value: 'hidden', priority: 'important' })
  assert.deepEqual(runtime.messages.at(-1), {
    event: 'application-presentation',
    detail: { visible: false, inputActive: false },
  })
  const messageCount = runtime.messages.length
  runtime.controller.setHostInputActive(true)
  assert.equal(runtime.messages.length, messageCount, 'host state must not echo to the host')
  assert.equal(owner.show(), true)
  assert.deepEqual(runtime.messages.at(-1).detail, { visible: true, inputActive: true })
  assert.equal(owner.deactivateInput(), true)
  assert.deepEqual(runtime.messages.at(-1).detail, { visible: true, inputActive: false })

  owner.replaceApplication(-1, 2)
  assert.match(runtime.messages.at(-1).detail.message, /Invalid replaceApplication/)
  owner.replaceApplication(1, 2, 'ait://current')
  assert.deepEqual(runtime.messages.at(-1), {
    event: 'replace-application',
    detail: { organizationId: 1, applicationId: 2, aitUrl: 'ait://current' },
  })
  owner.exitFromManagedState('https://example.test/')
  assert.deepEqual(runtime.messages.at(-1), {
    event: 'exit-managed-state',
    detail: { url: 'https://example.test/' },
  })
  owner.destroyApplication()
  assert.equal(runtime.messages.at(-1).event, 'destroy')
  assert.equal(owner.getApplicationBoundaryAndPermissionDescriptor(), null)

  assert.equal(runtime.controller.updateApplicationInformation({
    type: 'replacement',
    organizationId: 40,
    applicationId: 50,
  }), true)
  assert.equal(owner.type, 'replacement')
  assert.equal(owner.organization_id, 40)
  assert.equal(owner.application_id, 50)
  assert.equal(owner.control_code, '')
  assert.equal(owner.autostart_priority, 0)
}

{
  const calls = []
  const nhksh = {
    lu(url, ...args) {
      calls.push({ receiver: this, url, args })
      return 'navigated'
    },
  }
  const runtime = createRuntime({ nhksh })
  runtime.controller.startDocument()
  const guarded = nhksh.lu
  runtime.controller.startDocument()
  assert.equal(nhksh.lu, guarded, 'navigation policy must be installed only once')
  assert.equal(nhksh.lu('./next.html', 1, 2), 'navigated')
  assert.equal(calls[0].receiver, nhksh)
  assert.equal(calls[0].url, 'https://receiver.example/data-broadcast/app/next.html')
  assert.deepEqual(calls[0].args, [1, 2])
  assert.equal(nhksh.lu('https://outside.example/page'), false)
  assert.deepEqual(runtime.messages.at(-1), {
    event: 'navigation-blocked',
    detail: { url: 'https://outside.example/page' },
  })
}

{
  const runtime = createRuntime({
    resolveRuntimeUrl(value) {
      const url = new URL(String(value), 'https://receiver.example/data-broadcast/app/index.html')
      if (url.pathname === '/legacy') {
        return new URL('https://receiver.example/data-broadcast/app/legacy')
      }
      return url
    },
  })
  runtime.controller.startNavigationCapture()
  runtime.controller.startNavigationCapture()
  assert.equal(runtime.document.listenerCount('click'), 1)

  const eventFor = href => ({
    target: new FakeElement({ href }),
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true },
    stopImmediatePropagation() { this.stopped = true },
  })
  const unchanged = eventFor('https://receiver.example/data-broadcast/app/current')
  runtime.document.dispatch('click', unchanged)
  assert.equal(unchanged.prevented, false)

  const rewritten = eventFor('https://receiver.example/legacy')
  runtime.document.dispatch('click', rewritten)
  assert.equal(rewritten.prevented, true)
  assert.equal(rewritten.stopped, true)
  assert.equal(
    runtime.target.location.href,
    'https://receiver.example/data-broadcast/app/legacy',
  )

  const blocked = eventFor('https://outside.example/page')
  runtime.document.dispatch('click', blocked)
  assert.equal(blocked.prevented, true)
  assert.equal(blocked.stopped, true)
  assert.equal(runtime.messages.at(-1).event, 'navigation-blocked')

  runtime.controller.dispose()
  assert.equal(runtime.document.listenerCount('click'), 0)
}

{
  const runtime = createRuntime()
  runtime.target.location.href = 'https://communication.example/member/page.html'
  const withinBoundary = runtime.controller.updateApplicationInformation({
    permissionManagedAreas: [{
      permissionBitmaps: [0x2000],
      managedUrls: ['https://different.example/'],
    }],
  })
  assert.equal(withinBoundary, false)
  assert.equal(runtime.controller.permits(5), false)
  assert.throws(
    () => runtime.controller.requirePermission(5),
    error => error.name === 'Error' && error.code === 'NOT_AUTHORIZED_ERR',
  )
}

console.log('runtime application controller tests passed')
