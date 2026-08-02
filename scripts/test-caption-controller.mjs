import assert from 'node:assert/strict'

import { RuntimeCaptionController } from '../src/runtime/caption-controller.ts'

let permissionChecks = 0
const runtimeMessages = []
const controller = new RuntimeCaptionController({
  requirePermission() {
    permissionChecks += 1
  },
  postRuntime(event, detail) {
    runtimeMessages.push({ event, detail })
  },
})

const object = {}
controller.installBroadcastObjectApi(object)
assert.equal(typeof object.isCaptionExistent, 'function')
assert.equal(typeof object.addCaptionListener, 'function')
assert.equal(typeof object.removeCaptionListener, 'function')

assert.equal(controller.handleHostMessage({
  event: 'caption-tracks',
  componentTags: ['56', 57, 56.5, 'invalid'],
}), true)
assert.equal(object.isCaptionExistent('/captions/0038?language=jpn'), true)
assert.equal(object.isCaptionExistent('/captions/0039#main'), true)
assert.equal(object.isCaptionExistent('/captions/003a'), false)
assert.equal(object.isCaptionExistent('/captions/not-a-tag'), false)

const receivedA = []
const receivedB = []
const receivedC = []
const listenerA = payload => receivedA.push(payload)
const listenerB = payload => receivedB.push(payload)
const listenerC = payload => receivedC.push(payload)
assert.equal(object.addCaptionListener(listenerA, '/captions/0038'), true)
assert.deepEqual(runtimeMessages.at(-1), {
  event: 'caption-subscription',
  detail: { componentTags: [56] },
})
assert.equal(object.addCaptionListener(listenerB, '/captions/0038'), true)
assert.deepEqual(runtimeMessages.at(-1).detail, { componentTags: [56] })
assert.equal(object.addCaptionListener(listenerC, '/captions/0039'), true)
assert.deepEqual(runtimeMessages.at(-1).detail, { componentTags: [56, 57] })

const messagesBeforeInvalidListener = runtimeMessages.length
assert.equal(object.addCaptionListener(null, '/captions/0038'), false)
assert.equal(object.addCaptionListener(() => {}, '/captions/no-tag'), false)
assert.equal(runtimeMessages.length, messagesBeforeInvalidListener)

assert.equal(controller.handleHostMessage({
  event: 'caption-data',
  componentTag: '56',
  payload: 'receiver-payload',
}), true)
assert.deepEqual(receivedA, ['receiver-payload'])
assert.deepEqual(receivedB, ['receiver-payload'])
assert.deepEqual(receivedC, [])

assert.equal(controller.handleHostMessage({
  event: 'caption-data',
  componentTag: 57,
  dataType: null,
  tmd: 0,
  data: false,
}), true)
assert.deepEqual(receivedC, [JSON.stringify({
  data_type: '0000',
  TMD: '0',
  data: 'false',
})])
assert.equal(controller.handleHostMessage({ event: 'program-info' }), false)

const messagesBeforeMissingRemoval = runtimeMessages.length
assert.equal(object.removeCaptionListener(() => {}), false)
assert.equal(runtimeMessages.length, messagesBeforeMissingRemoval)
assert.equal(object.removeCaptionListener(listenerB), true)
assert.deepEqual(runtimeMessages.at(-1).detail, { componentTags: [56, 57] })
assert.equal(object.removeCaptionListener(listenerA), true)
assert.deepEqual(runtimeMessages.at(-1).detail, { componentTags: [57] })

assert.equal(controller.handleHostMessage({ event: 'caption-reset' }), true)
assert.deepEqual(runtimeMessages.at(-1), {
  event: 'caption-subscription',
  detail: { componentTags: [] },
})
assert.equal(object.isCaptionExistent('/captions/0038'), false)
controller.handleHostMessage({ event: 'caption-data', componentTag: 57, payload: 'late' })
assert.deepEqual(receivedC, [JSON.stringify({
  data_type: '0000',
  TMD: '0',
  data: 'false',
})])

const existingIsCaptionExistent = () => 'existing'
const existingAddCaptionListener = () => 'existing'
const existingRemoveCaptionListener = () => 'existing'
const existingObject = {
  isCaptionExistent: existingIsCaptionExistent,
  addCaptionListener: existingAddCaptionListener,
  removeCaptionListener: existingRemoveCaptionListener,
}
controller.installBroadcastObjectApi(existingObject)
assert.equal(existingObject.isCaptionExistent, existingIsCaptionExistent)
assert.equal(existingObject.addCaptionListener, existingAddCaptionListener)
assert.equal(existingObject.removeCaptionListener, existingRemoveCaptionListener)

assert.equal(permissionChecks, 13)

console.log('runtime caption controller contracts passed')
