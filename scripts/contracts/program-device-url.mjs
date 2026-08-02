import assert from 'node:assert/strict'
import vm from 'node:vm'

import {
  deriveBroadcastRootUrl,
  normalizeBroadcastBaseUrl,
  resolveBroadcastUrl,
} from '../../src/broadcast-url.ts'
import { cloneProgramInfo } from '../../src/program-info.ts'
import {
  DEFAULT_RECEIVER_DEVICE_IDENTIFIER,
  getDefaultReceiverIrdId,
  resolveReceiverDeviceIdentifier,
} from '../../src/device-identifier.ts'

const programStart = new Date('2026-07-31T12:00:00Z')
const program = cloneProgramInfo({
  service_id: 101,
  event_id: 42,
  start_time: programStart,
  duration: 30 * 60 * 1000,
})
assert.notEqual(program.start_time, programStart)
assert.equal(program.start_time.getTime(), programStart.getTime())
const iframeDate = vm.runInNewContext('new Date("2026-07-31T12:00:00Z")')
assert.equal(cloneProgramInfo({ start_time: iframeDate }).start_time.getTime(), programStart.getTime())
assert.throws(() => cloneProgramInfo({ start_time: '2026-07-31T12:00:00Z' }), /valid Date/)
assert.throws(() => cloneProgramInfo({ duration: -1 }), /millisecond duration/)
assert.equal(await resolveReceiverDeviceIdentifier(0), DEFAULT_RECEIVER_DEVICE_IDENTIFIER)
assert.equal(await resolveReceiverDeviceIdentifier(7, kind => `receiver-${kind}`), 'receiver-7')
assert.equal(await resolveReceiverDeviceIdentifier(9, () => null), '')
assert.equal(getDefaultReceiverIrdId(5), DEFAULT_RECEIVER_DEVICE_IDENTIFIER)
assert.equal(getDefaultReceiverIrdId(4), null)
const origin = 'https://receiver.example/player/index.html'
const base = normalizeBroadcastBaseUrl(undefined, origin)
assert.equal(base.href, 'https://receiver.example/data-broadcast/')
const root = deriveBroadcastRootUrl(
  'https://receiver.example/data-broadcast/bsfuji4k/40/0000/html/index.html',
  base,
)
assert.equal(root.href, 'https://receiver.example/data-broadcast/bsfuji4k/')
assert.equal(
  resolveBroadcastUrl('/60/002/caption/source/index.html', base, root).pathname,
  '/data-broadcast/bsfuji4k/60/002/caption/source/index.html',
)
assert.equal(
  resolveBroadcastUrl('/bsfuji4k/60/001/top/index.html', base, root).pathname,
  '/data-broadcast/bsfuji4k/60/001/top/index.html',
)
assert.equal(
  resolveBroadcastUrl('/sh4/60/001/index.html?x=1#top', base).href,
  'https://receiver.example/data-broadcast/sh4/60/001/index.html?x=1#top',
)
assert.equal(
  resolveBroadcastUrl('/data-broadcast/sh4/index.html', base).pathname,
  '/data-broadcast/sh4/index.html',
)
