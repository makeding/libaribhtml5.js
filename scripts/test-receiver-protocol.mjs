import assert from 'node:assert/strict'

import {
  normalizeApplicationReplaceRequest,
  normalizeCaptionSubscriptionTags,
  normalizeMediaLayer,
  normalizeMediaPlane,
  normalizeStageBackgroundColor,
} from '../src/receiver/protocol.ts'

assert.equal(normalizeStageBackgroundColor(undefined), null)
assert.equal(normalizeStageBackgroundColor(null), null)
assert.equal(normalizeStageBackgroundColor(''), null)
assert.equal(normalizeStageBackgroundColor('transparent'), null)
assert.equal(normalizeStageBackgroundColor('rgba(0, 0, 0, 0)'), null)
assert.equal(normalizeStageBackgroundColor('rgb(1, 2, 3)'), 'rgb(1, 2, 3)')
assert.equal(normalizeStageBackgroundColor(0), '0')

assert.deepEqual(normalizeCaptionSubscriptionTags(undefined), [])
assert.deepEqual(normalizeCaptionSubscriptionTags('8'), [])
assert.deepEqual(
  normalizeCaptionSubscriptionTags([8, '8', 0, 0xffff, -1, 0x10000, 1.5, NaN]),
  [8, 0, 0xffff],
)

assert.deepEqual(normalizeApplicationReplaceRequest({
  organizationId: '42',
  applicationId: 7,
  aitUrl: 123,
}), {
  organizationId: 42,
  applicationId: 7,
  aitUrl: '123',
})
assert.deepEqual(normalizeApplicationReplaceRequest({
  organizationId: 0,
  applicationId: 0,
}), {
  organizationId: 0,
  applicationId: 0,
  aitUrl: null,
})
assert.equal(normalizeApplicationReplaceRequest({
  organizationId: -1,
  applicationId: 2,
}), null)
assert.equal(normalizeApplicationReplaceRequest({
  organizationId: Number.MAX_SAFE_INTEGER + 1,
  applicationId: 2,
}), null)
assert.equal(normalizeApplicationReplaceRequest({
  organizationId: 1,
  applicationId: 2.5,
}), null)

assert.deepEqual(normalizeMediaLayer(undefined), {
  documentOrder: -1,
  stackingPath: [],
})
assert.deepEqual(normalizeMediaLayer({}), {
  documentOrder: 0,
  stackingPath: [],
  externalPlacement: 'behind-application',
})
const stackingPath = [{ tagName: 'object' }]
assert.deepEqual(normalizeMediaLayer({
  documentOrder: '12',
  stackingPath,
  externalPlacement: 'above-application',
}), {
  documentOrder: 12,
  stackingPath,
  externalPlacement: 'above-application',
})
assert.deepEqual(normalizeMediaLayer({
  documentOrder: 'invalid',
  stackingPath: 'invalid',
  externalPlacement: 'invalid',
}), {
  documentOrder: 0,
  stackingPath: [],
  externalPlacement: 'behind-application',
})

assert.deepEqual(normalizeMediaPlane({
  slotId: 17,
  visible: false,
  x: 99,
  screenWidth: 1,
  layer: null,
}, {
  screenWidth: 7680,
  screenHeight: 4320,
}), {
  slotId: '17',
  visible: false,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  screenWidth: 7680,
  screenHeight: 4320,
  layer: { documentOrder: -1, stackingPath: [] },
})

assert.deepEqual(normalizeMediaPlane({
  slotId: 'main',
  visible: 'yes',
  x: '10.5',
  y: -20,
  width: '1920',
  height: 0,
  screenWidth: 0,
  screenHeight: '2160',
  videoSource: '/video',
  audioSource: 12,
  layer: {
    documentOrder: 4,
    stackingPath,
    externalPlacement: 'above-application',
  },
}, {
  screenWidth: 111,
  screenHeight: 222,
}), {
  slotId: 'main',
  visible: true,
  x: 10.5,
  y: -20,
  width: 1920,
  height: 0,
  screenWidth: 3840,
  screenHeight: 2160,
  videoSource: '/video',
  audioSource: undefined,
  layer: {
    documentOrder: 4,
    stackingPath,
    externalPlacement: 'above-application',
  },
})

console.log('receiver protocol tests passed')
