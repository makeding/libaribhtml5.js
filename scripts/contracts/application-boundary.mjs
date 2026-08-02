import assert from 'node:assert/strict'

import {
  ARIB_PERMISSION_BITS,
  AribApplicationBoundaryPolicy,
} from '../../src/runtime/application-boundary.ts'

const bitmap1 = (...bits) => 0x2000 | bits.reduce((value, bit) => value | (1 << bit), 0)
const unrestrictedBoundary = new AribApplicationBoundaryPolicy(
  'https://receiver.example/data-broadcast/',
  'https://receiver.example/data-broadcast/app/index.html',
)
assert.equal(
  unrestrictedBoundary.permits(
    'https://communication.example/app/',
    ARIB_PERMISSION_BITS.deviceIdentifier,
  ),
  true,
)

const scopedBoundary = new AribApplicationBoundaryPolicy(
  'https://receiver.example/data-broadcast/',
  'https://receiver.example/data-broadcast/app/index.html',
  [
    { permissionBitmaps: [bitmap1()], managedUrls: null },
    {
      permissionBitmaps: [bitmap1(
        ARIB_PERMISSION_BITS.broadcastResources,
        ARIB_PERMISSION_BITS.deviceIdentifier,
      )],
      managedUrls: ['https://communication.example/member/'],
    },
  ],
)
assert.equal(
  scopedBoundary.permits(
    'https://communication.example/member/page.html',
    ARIB_PERMISSION_BITS.deviceIdentifier,
  ),
  true,
)
assert.equal(
  scopedBoundary.permits(
    'https://communication.example/memberish/page.html',
    ARIB_PERMISSION_BITS.deviceIdentifier,
  ),
  false,
)
assert.equal(
  scopedBoundary.evaluate('https://outside.example/').withinBoundary,
  true,
)
assert.equal(
  scopedBoundary.permits(
    'https://outside.example/',
    ARIB_PERMISSION_BITS.broadcastResources,
  ),
  false,
)
assert.equal(
  scopedBoundary.permits(
    'https://receiver.example/data-broadcast/app/index.html',
    ARIB_PERMISSION_BITS.cas,
  ),
  true,
)

const finiteBoundary = new AribApplicationBoundaryPolicy(
  'https://receiver.example/data-broadcast/',
  'https://receiver.example/data-broadcast/app/index.html',
  [{ permissionBitmaps: [bitmap1(ARIB_PERMISSION_BITS.broadcastResources)], managedUrls: [
    'https://communication.example/member/',
  ] }],
)
assert.equal(finiteBoundary.evaluate('https://outside.example/').withinBoundary, false)
assert.equal(finiteBoundary.evaluate('https://communication.example/member/').withinBoundary, true)

const invalidBitmap0 = new AribApplicationBoundaryPolicy(
  'https://receiver.example/data-broadcast/',
  'https://receiver.example/data-broadcast/app/index.html',
  [{ permissionBitmaps: [1 << ARIB_PERMISSION_BITS.deviceIdentifier], managedUrls: null }],
)
assert.equal(
  invalidBitmap0.permits('https://communication.example/', ARIB_PERMISSION_BITS.deviceIdentifier),
  false,
)
finiteBoundary.addPermissionManagedArea({
  permission: [bitmap1(ARIB_PERMISSION_BITS.deviceIdentifier)],
  urls: ['https://device.example/'],
})
assert.equal(
  finiteBoundary.permits('https://device.example/path', ARIB_PERMISSION_BITS.deviceIdentifier),
  true,
)
const boundarySnapshot = finiteBoundary.getCurrentBoundary()
boundarySnapshot[0].permission[0] = 0
assert.equal(
  finiteBoundary.permits(
    'https://communication.example/member/',
    ARIB_PERMISSION_BITS.broadcastResources,
  ),
  true,
)
assert.throws(
  () => finiteBoundary.addPermissionManagedArea({ permission: undefined, urls: null }),
  error => error.code === 'INVALID_PARAM_ERR',
)
