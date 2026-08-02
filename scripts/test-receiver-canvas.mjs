import assert from 'node:assert/strict'
import { register } from 'node:module'

register(new URL('./helpers/test-typescript-resolver.mjs', import.meta.url))

const { ReceiverCanvasController } = await import(
  '../src/receiver/canvas-controller.ts'
)

const iframe = { style: {} }
const viewport = {
  clientWidth: 1920,
  clientHeight: 1080,
  style: { backgroundColor: 'unchanged' },
}
let resizeCallback
let observedElement
let disconnectCount = 0
const controller = new ReceiverCanvasController({
  iframe,
  viewport,
  createResizeObserver(callback) {
    resizeCallback = callback
    return {
      observe(element) { observedElement = element },
      disconnect() { disconnectCount += 1 },
    }
  },
})

assert.equal(observedElement, viewport)
assert.deepEqual(controller.logicalSize, { width: 3840, height: 2160 })
assert.equal(iframe.style.width, '3840px')
assert.equal(iframe.style.height, '2160px')
assert.equal(iframe.style.transform, 'scale(0.5)')
assert.equal(viewport.style.aspectRatio, undefined)
assert.equal(viewport.style.backgroundColor, 'unchanged')

controller.applyScreenSize(1920, 1080)
assert.deepEqual(controller.logicalSize, { width: 1920, height: 1080 })
assert.equal(viewport.style.aspectRatio, '1920 / 1080')
assert.equal(iframe.style.width, '1920px')
assert.equal(iframe.style.height, '1080px')
assert.equal(iframe.style.transform, 'scale(1)')

viewport.clientWidth = 800
viewport.clientHeight = 600
resizeCallback([], {})
assert.equal(iframe.style.transform, `scale(${800 / 1920})`)

controller.setStageBackgroundColor('rgb(1, 2, 3)')
assert.equal(viewport.style.backgroundColor, 'rgb(1, 2, 3)')
controller.setLctBackgroundColor(0x12abef)
assert.equal(viewport.style.backgroundColor, '#12abef')
controller.setStageBackgroundColor('rgb(4, 5, 6)')
assert.equal(viewport.style.backgroundColor, '#12abef')
controller.resetStageBackground()
assert.equal(viewport.style.backgroundColor, '#12abef')
controller.setLctBackgroundColor(null)
assert.equal(viewport.style.backgroundColor, '#000')
controller.setStageBackgroundColor('rgb(7, 8, 9)')
assert.equal(viewport.style.backgroundColor, 'rgb(7, 8, 9)')
controller.setLctBackgroundColor(0)
controller.resetStageBackground()
assert.equal(viewport.style.backgroundColor, '#000000')
controller.setLctBackgroundColor(null)
assert.equal(viewport.style.backgroundColor, '#000')
assert.throws(() => controller.setLctBackgroundColor(0x1000000), /24-bit integer/)

controller.dispose()
assert.equal(disconnectCount, 1)

console.log('receiver canvas controller tests passed')
