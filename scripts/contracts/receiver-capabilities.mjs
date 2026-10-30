import assert from 'node:assert/strict'
import { createReceiverCapabilities, receiverSourceIs } from '../../src/runtime/capabilities.ts'

let source = 'onair'
const options = { supportedMedia: ['6'], getInputSource: () => source }
const capabilities = createReceiverCapabilities(options)
assert.equal(capabilities.hasCapability('Media', '6'), true)
assert.equal(capabilities.hasCapability('Media', '1'), false)
assert.equal(capabilities.hasCapability('Media', '4'), false)
assert.equal(capabilities.hasCapability('APIGroup', 'sourceIs'), true)
assert.equal(capabilities.hasCapability('APIGroup', 'dataEventIDUpdate'), false)
assert.equal(capabilities.hasCapability('CASystem', '5'), false)
assert.equal(capabilities.hasCapability('Media', '6', 'extra'), false)
assert.equal(capabilities.hasCapability('unknown'), false)
assert.equal(createReceiverCapabilities({}).hasCapability('Media', '6'), false)
assert.equal(receiverSourceIs(options, 'onair'), true)
source = 'recorded'
assert.equal(receiverSourceIs(options, 'onair'), false)
assert.equal(receiverSourceIs(options, 'recorded'), false)
assert.equal(receiverSourceIs({}, 'onair'), false)
