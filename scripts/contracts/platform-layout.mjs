import assert from 'node:assert/strict'

import { makeIframePointerTransparent } from '../../src/iframe-input.ts'
import { shouldSuppressRomSoundPlayback } from '../../src/runtime/platform.ts'
import {
  normalizeLctBackgroundColor,
  resolveReceiverBackgroundColor,
} from '../../src/layout.ts'

const receiverIframe = {
  inert: false,
  style: {
    values: {},
    priorities: {},
    setProperty(property, value, priority = '') {
      this.values[property] = value
      this.priorities[property] = priority
    },
  },
  tabIndex: 0,
}
makeIframePointerTransparent(receiverIframe)
assert.equal(receiverIframe.inert, true)
assert.equal(receiverIframe.style.values['pointer-events'], 'none')
assert.equal(receiverIframe.style.priorities['pointer-events'], 'important')
assert.equal(receiverIframe.tabIndex, -1)
assert.equal(shouldSuppressRomSoundPlayback({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)',
  platform: 'iPhone',
  maxTouchPoints: 5,
}), true)
assert.equal(shouldSuppressRomSoundPlayback({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
  platform: 'MacIntel',
  maxTouchPoints: 5,
}), true)
assert.equal(shouldSuppressRomSoundPlayback({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
  platform: 'MacIntel',
  maxTouchPoints: 0,
}), false)
assert.equal(normalizeLctBackgroundColor(0), '#000000')
assert.equal(normalizeLctBackgroundColor(0x12abef), '#12abef')
assert.equal(normalizeLctBackgroundColor(null), null)
assert.throws(() => normalizeLctBackgroundColor(-1), /24-bit integer/)
assert.throws(() => normalizeLctBackgroundColor(0x1000000), /24-bit integer/)
assert.throws(() => normalizeLctBackgroundColor(1.5), /24-bit integer/)
assert.equal(resolveReceiverBackgroundColor('#123456', 'rgb(1, 2, 3)'), '#123456')
assert.equal(resolveReceiverBackgroundColor(null, 'rgb(1, 2, 3)'), 'rgb(1, 2, 3)')
assert.equal(resolveReceiverBackgroundColor(null, null), '#000')
