import assert from 'node:assert/strict'

import { resolveBroadcastMediaSlot } from '../../src/runtime/media-slot.ts'
import { BehindIframeMediaPlaneAdapter } from '../../src/media-plane.ts'

const mediaRect = (left, top, width, height) => ({
  x: left,
  y: top,
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
})
const mediaDocument = { body: {}, documentElement: {} }
const mediaStyle = (values = {}) => ({
  getPropertyValue(property) { return values[property] ?? '' },
})
const mediaElement = ({ rect, parent = null, attributes = [], style = {} }) => ({
  ownerDocument: mediaDocument,
  parentElement: parent,
  children: [],
  firstElementChild: null,
  style: mediaStyle(style),
  hasAttribute(name) { return attributes.includes(name) },
  getBoundingClientRect() { return rect },
})

const mediaWrapper = mediaElement({ rect: mediaRect(216, 134, 1440, 810) })
const defaultSizedMediaObject = mediaElement({
  rect: mediaRect(216, 134, 300, 150),
  parent: mediaWrapper,
})
mediaWrapper.children = [defaultSizedMediaObject]
mediaWrapper.firstElementChild = defaultSizedMediaObject
assert.equal(resolveBroadcastMediaSlot(defaultSizedMediaObject).element, mediaWrapper)
assert.deepEqual(resolveBroadcastMediaSlot(defaultSizedMediaObject).rect, mediaRect(216, 134, 1440, 810))

const explicitlySizedMediaObject = mediaElement({
  rect: mediaRect(216, 134, 640, 360),
  parent: mediaWrapper,
  attributes: ['width', 'height'],
})
mediaWrapper.children = [explicitlySizedMediaObject]
mediaWrapper.firstElementChild = explicitlySizedMediaObject
assert.equal(resolveBroadcastMediaSlot(explicitlySizedMediaObject).element, explicitlySizedMediaObject)

const mediaWrapperWithOverlay = mediaElement({ rect: mediaRect(216, 134, 1440, 810) })
const overlaidDefaultObject = mediaElement({
  rect: mediaRect(216, 134, 300, 150),
  parent: mediaWrapperWithOverlay,
})
const mediaOverlay = mediaElement({ rect: mediaRect(216, 134, 1440, 810) })
mediaWrapperWithOverlay.children = [overlaidDefaultObject, mediaOverlay]
mediaWrapperWithOverlay.firstElementChild = overlaidDefaultObject
assert.equal(resolveBroadcastMediaSlot(overlaidDefaultObject).element, overlaidDefaultObject)

const externalSurface = { style: {} }
const externalAdapter = new BehindIframeMediaPlaneAdapter({ surface: externalSurface })
const externalPlane = {
  slotId: 'test',
  visible: true,
  x: 480,
  y: 54,
  width: 2880,
  height: 1620,
  screenWidth: 3840,
  screenHeight: 2160,
  layer: { documentOrder: 0, stackingPath: [], externalPlacement: 'behind-application' },
}
externalAdapter.mountMediaPlane(null, externalPlane)
assert.equal(externalSurface.style.zIndex, '0')
externalAdapter.updateMediaPlane(null, {
  ...externalPlane,
  layer: { ...externalPlane.layer, externalPlacement: 'above-application' },
})
assert.equal(externalSurface.style.zIndex, '2')
