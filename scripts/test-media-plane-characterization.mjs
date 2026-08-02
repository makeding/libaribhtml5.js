import assert from 'node:assert/strict'
import { register } from 'node:module'

import {
  FakeElement,
  append,
  createFakeMediaPlaneWindow,
  inlineStyleSnapshot,
  rect,
} from './helpers/media-plane-fake-dom.mjs'

/**
 * Reusable behavioral contract for the production external-media-hole
 * controller. Keeping the factory boundary makes every case independent.
 *
 * Expected controller surface:
 *   create(target) -> {
 *     set(object, enabled),
 *     restore(),
 *     describeStackingPath(object),
 *   }
 */
export function runExternalMediaHoleContract(create) {
  preservesInlineValuesAndPriorities(create)
  repeatedEnableKeepsFirstSnapshot(create)
  switchingObjectsRestoresThePreviousHole(create)
  restoreReturnsEveryTrackedElement(create)
}

export const externalMediaHoleCharacterizationCases = Object.freeze([
  'preserves inline values and priorities',
  'repeated enable keeps the first snapshot',
  'switching objects restores the previous hole',
  'restore returns every tracked element',
])

function mediaScene() {
  const { target, document } = createFakeMediaPlaneWindow()
  const wrapper = new FakeElement({
    id: 'video-wrapper',
    box: rect(100, 200, 1280, 720),
    style: { opacity: { value: '0.6', priority: 'important' } },
    computed: { opacity: '0.6', backgroundColor: 'rgb(10, 20, 30)' },
  })
  const object = new FakeElement({
    tagName: 'object',
    id: 'video-object',
    box: rect(100, 200, 1280, 720),
    style: { opacity: '0.75' },
    computed: { opacity: '0.75' },
    attributes: ['width', 'height'],
  })
  const overlay = new FakeElement({
    id: 'covering-background',
    box: rect(0, 0, 3840, 2160),
    style: {
      'background-color': { value: 'rgb(1, 2, 3)', priority: 'important' },
      'background-image': { value: 'url(stage.png)', priority: '' },
    },
    computed: {
      backgroundColor: 'rgb(1, 2, 3)',
      backgroundImage: 'url(stage.png)',
    },
  })
  append(wrapper, object)
  append(document.body, wrapper, overlay)
  return { target, document, wrapper, object, overlay }
}

function preservesInlineValuesAndPriorities(create) {
  const scene = mediaScene()
  const controller = create(scene.target)
  const wrapperBefore = inlineStyleSnapshot(scene.wrapper, 'opacity', 'background-color')
  const objectBefore = inlineStyleSnapshot(scene.object, 'opacity')
  const overlayBefore = inlineStyleSnapshot(
    scene.overlay,
    'background-color',
    'background-image',
  )

  controller.set(scene.object, true)
  assert.deepEqual(inlineStyleSnapshot(scene.wrapper, 'opacity').opacity, {
    value: '0', priority: 'important',
  })
  assert.deepEqual(inlineStyleSnapshot(scene.object, 'opacity').opacity, {
    value: '0', priority: 'important',
  })
  assert.deepEqual(inlineStyleSnapshot(scene.overlay, 'background-color')['background-color'], {
    value: 'transparent', priority: 'important',
  })
  assert.deepEqual(inlineStyleSnapshot(scene.overlay, 'background-image')['background-image'], {
    value: 'none', priority: 'important',
  })
  assert.deepEqual(
    controller.describeStackingPath(scene.object).map(entry => entry.opacity),
    [1, 1, 0.6, 0.75],
    'stacking report must retain pre-hole opacity',
  )

  controller.set(scene.object, false)
  assert.deepEqual(inlineStyleSnapshot(scene.wrapper, 'opacity', 'background-color'), wrapperBefore)
  assert.deepEqual(inlineStyleSnapshot(scene.object, 'opacity'), objectBefore)
  assert.deepEqual(
    inlineStyleSnapshot(scene.overlay, 'background-color', 'background-image'),
    overlayBefore,
  )
}

function repeatedEnableKeepsFirstSnapshot(create) {
  const scene = mediaScene()
  const controller = create(scene.target)
  const before = inlineStyleSnapshot(scene.wrapper, 'opacity')

  controller.set(scene.object, true)
  controller.set(scene.object, true)
  controller.set(scene.object, false)

  assert.deepEqual(inlineStyleSnapshot(scene.wrapper, 'opacity'), before)
}

function switchingObjectsRestoresThePreviousHole(create) {
  const scene = mediaScene()
  const secondWrapper = new FakeElement({
    id: 'second-wrapper',
    box: rect(1600, 200, 960, 540),
    style: { opacity: '0.4' },
    computed: { opacity: '0.4' },
  })
  const secondObject = new FakeElement({
    tagName: 'object',
    id: 'second-object',
    box: rect(1600, 200, 960, 540),
    style: { opacity: '0.5' },
    computed: { opacity: '0.5' },
    attributes: ['width', 'height'],
  })
  append(secondWrapper, secondObject)
  append(scene.document.body, secondWrapper)
  const controller = create(scene.target)

  controller.set(scene.object, true)
  controller.set(secondObject, true)

  assert.equal(scene.object.style.getPropertyValue('opacity'), '0.75')
  assert.equal(scene.wrapper.style.getPropertyValue('opacity'), '0.6')
  assert.equal(secondObject.style.getPropertyValue('opacity'), '0')
  assert.equal(secondWrapper.style.getPropertyValue('opacity'), '0')
}

function restoreReturnsEveryTrackedElement(create) {
  const scene = mediaScene()
  const controller = create(scene.target)
  const before = {
    wrapper: inlineStyleSnapshot(scene.wrapper, 'opacity'),
    object: inlineStyleSnapshot(scene.object, 'opacity'),
    overlay: inlineStyleSnapshot(scene.overlay, 'background-color', 'background-image'),
  }

  controller.set(scene.object, true)
  controller.restore()

  assert.deepEqual(inlineStyleSnapshot(scene.wrapper, 'opacity'), before.wrapper)
  assert.deepEqual(inlineStyleSnapshot(scene.object, 'opacity'), before.object)
  assert.deepEqual(
    inlineStyleSnapshot(scene.overlay, 'background-color', 'background-image'),
    before.overlay,
  )
}

function runtimeScene(RuntimeMediaPlaneController) {
  const scene = mediaScene()
  const runtimeEvents = []
  const adapterEvents = []
  const installedObjects = []
  const adapter = {
    renderMode: 'external',
    mountMediaPlane(object, plane) {
      adapterEvents.push({ type: 'mount', object, plane })
    },
    updateMediaPlane(object, plane) {
      adapterEvents.push({ type: 'update', object, plane })
    },
    unmountMediaPlane(reason) {
      adapterEvents.push({ type: 'unmount', reason })
    },
  }
  const controller = new RuntimeMediaPlaneController({
    target: scene.target,
    adapter,
    canUseBroadcastMedia: () => true,
    installBroadcastObjectApi: object => installedObjects.push(object),
    postRuntime: (event, detail = {}) => runtimeEvents.push({ event, detail }),
  })
  return { ...scene, controller, adapter, runtimeEvents, adapterEvents, installedObjects }
}

async function runRuntimeMediaPlaneControllerContract(RuntimeMediaPlaneController) {
  {
    const scene = runtimeScene(RuntimeMediaPlaneController)
    scene.controller.startDocument()
    scene.controller.schedule()
    scene.controller.schedule()
    assert.equal(scene.target.pendingAnimationFrames(), 1, 'RAF requests must coalesce')
    assert.deepEqual(scene.runtimeEvents, [], 'reports must wait for the animation frame')

    scene.target.flushAnimationFrames(16)
    assert.deepEqual(
      scene.runtimeEvents.map(entry => entry.event),
      ['stage-style', 'media-plane'],
      'the first frame must sample stage style before clearing/reporting the media plane',
    )
    assert.equal(scene.runtimeEvents[0].detail.backgroundColor, 'rgb(1, 2, 3)')
    assert.equal(scene.target.pendingAnimationFrames(), 0, 'an idle plane must not poll forever')
  }

  {
    const scene = runtimeScene(RuntimeMediaPlaneController)
    const animation = {
      playState: 'running',
      effect: { target: scene.object },
    }
    scene.document.animations = [animation]
    scene.controller.schedule()
    scene.target.flushAnimationFrames(16)
    assert.equal(
      scene.target.pendingAnimationFrames(),
      1,
      'a running animation which affects the media object must schedule another frame',
    )

    animation.playState = 'finished'
    scene.target.flushAnimationFrames(32)
    assert.equal(
      scene.target.pendingAnimationFrames(),
      0,
      'polling must stop as soon as the relevant animation stops',
    )
  }

  {
    const scene = runtimeScene(RuntimeMediaPlaneController)
    scene.controller.startObserving()
    assert.equal(scene.target.pendingAnimationFrames(), 0)
    assert.deepEqual(scene.runtimeEvents, [], 'observer setup must not synchronously report')
    await Promise.resolve()
    assert.equal(scene.target.pendingAnimationFrames(), 1, 'observer startup queues one deferred RAF')
    assert.deepEqual(scene.runtimeEvents, [], 'the deferred RAF still owns the first report')
    scene.controller.dispose('document-unload')
  }

  {
    const scene = runtimeScene(RuntimeMediaPlaneController)
    scene.controller.schedule()
    scene.target.flushAnimationFrames(16)
    assert.equal(scene.adapterEvents[0].type, 'mount')
    const beforeRestore = inlineStyleSnapshot(scene.object, 'opacity')
    assert.equal(beforeRestore.opacity.value, '0')

    scene.controller.schedule()
    assert.equal(scene.target.pendingAnimationFrames(), 1)
    const disposalOrder = []
    const unmount = scene.adapter.unmountMediaPlane
    scene.adapter.unmountMediaPlane = reason => {
      disposalOrder.push('adapter-unmount')
      unmount.call(scene.adapter, reason)
    }
    scene.controller.dispose('document-unload', () => disposalOrder.push('before-unmount'))

    assert.equal(scene.target.pendingAnimationFrames(), 0, 'dispose must cancel an outstanding RAF')
    assert.deepEqual(disposalOrder, ['before-unmount', 'adapter-unmount'])
    assert.deepEqual(inlineStyleSnapshot(scene.object, 'opacity').opacity, {
      value: '0.75', priority: '',
    })
    scene.target.flushAnimationFrames(32)
    assert.deepEqual(
      scene.runtimeEvents.map(entry => entry.event),
      ['stage-style', 'media-plane'],
      'a cancelled frame must not report after disposal',
    )
  }
}

// Source modules use extensionless imports for Vite. Keep the production files
// unchanged while making this direct Node/strip-types test resolve them.
register(new URL('./helpers/test-typescript-resolver.mjs', import.meta.url))

const { ExternalMediaHoleController } = await import(
  '../src/runtime/external-media-hole.ts'
)
const { RuntimeMediaPlaneController } = await import(
  '../src/runtime/media-plane-runtime.ts'
)
runExternalMediaHoleContract(target => new ExternalMediaHoleController(target))
await runRuntimeMediaPlaneControllerContract(RuntimeMediaPlaneController)
console.log('external media-hole and runtime media-plane characterization tests passed')
