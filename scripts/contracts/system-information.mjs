import assert from 'node:assert/strict'
import packageMetadata from '../../package.json' with { type: 'json' }

import {
  createReceiverSystemInformation,
  readReceiverInformationArray,
  RECEIVER_SYSTEM_IDENTITY,
  synchronizeReceiverCompatibilityStorage,
} from '../../src/runtime/system-information.ts'

assert.deepEqual(RECEIVER_SYSTEM_IDENTITY, {
  browsername: packageMetadata.name,
  browserversion: packageMetadata.version,
  makerid: packageMetadata.author.name,
  modelname: packageMetadata.aribReceiver.modelName,
})
assert.deepEqual(createReceiverSystemInformation('https://receiver.example/data-broadcast/', {
  makerid: 'receiver-vendor',
  baseurl: 'https://wrong.example/',
  decoder: 'native',
}), {
  browsername: packageMetadata.name,
  browserversion: packageMetadata.version,
  makerid: 'receiver-vendor',
  modelname: packageMetadata.aribReceiver.modelName,
  decoder: 'native',
  baseurl: 'https://receiver.example/data-broadcast/',
})
const regionalSystemInformation = createReceiverSystemInformation(
  'https://receiver.example/data-broadcast/',
  { zipcode: '1234567', prefecture: 13, regioncode: 0x1c7 },
)
assert.deepEqual(
  readReceiverInformationArray(
    'receiverinfo/profile',
    'zipcode,prefecture,regioncode,unsupported',
    regionalSystemInformation,
  ),
  ['1234567', 13, 0x1c7, null],
)
const receiverCompatibilityStorage = new Map()
const receiverStorage = {
  setItem(key, value) { receiverCompatibilityStorage.set(key, String(value)) },
  removeItem(key) { receiverCompatibilityStorage.delete(key) },
}
synchronizeReceiverCompatibilityStorage(receiverStorage, regionalSystemInformation)
assert.equal(receiverCompatibilityStorage.get('_zipcode'), '1234567')
synchronizeReceiverCompatibilityStorage(
  receiverStorage,
  createReceiverSystemInformation('https://receiver.example/data-broadcast/', {
    zipcode: '210-0015',
  }),
)
assert.equal(receiverCompatibilityStorage.get('_zipcode'), '2100015')
synchronizeReceiverCompatibilityStorage(
  receiverStorage,
  createReceiverSystemInformation('https://receiver.example/data-broadcast/', {
    zipcode: 'invalid',
  }),
)
assert.equal(receiverCompatibilityStorage.has('_zipcode'), false)
assert.equal(
  readReceiverInformationArray('application/private', 'zipcode', regionalSystemInformation),
  null,
)
