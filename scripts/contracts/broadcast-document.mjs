import assert from 'node:assert/strict'
import vm from 'node:vm'

import {
  createRuntimeBootstrap,
  prepareBroadcastHtml,
  prepareBroadcastStylesheet,
} from '../../src/broadcast-document.ts'
import { DEFAULT_RECEIVER_DEVICE_IDENTIFIER } from '../../src/device-identifier.ts'

const preparedHtml = prepareBroadcastHtml(
  '<html><head><title>x</title></head><body>' +
  '<object type="video/x-arib2-broadcast" data=""></object>' +
  '<audio src="romsound://9"></audio><script src="/sh4/app.js"></script></body></html>',
  { bootstrap: '<script>install()</script>' },
)
assert.match(preparedHtml, /<head><script>install\(\)<\/script>/)
assert.match(preparedHtml, /data-arib-type="video\/x-arib2-broadcast"/)
assert.match(preparedHtml, /data-arib-romsound="romsound:\/\/9"/)
assert.match(preparedHtml, /src="\/data-broadcast\/sh4\/app\.js"/)

const runtimeBootstrap = createRuntimeBootstrap('/receiver-vfs/')
const bootstrapSource = runtimeBootstrap.replace(/^<script>|<\/script>$/g, '')
const scheduledBootstrap = []
const bootstrapParent = {}
const bootstrapContext = {
  console,
  location: { origin: 'https://receiver.example' },
  navigator: {},
  parent: bootstrapParent,
  queueMicrotask,
  setTimeout(callback) {
    scheduledBootstrap.push(callback)
  },
  URL,
}
bootstrapContext.window = bootstrapContext
vm.runInNewContext(bootstrapSource, bootstrapContext)
assert.equal(
  bootstrapContext.navigator.receiverDevice.getSystemInformation().baseurl,
  'https://receiver.example/receiver-vfs/',
)
let bootstrapDeviceIdentifier
bootstrapContext.navigator.receiverDevice.getDeviceIdentifier(5, value => {
  bootstrapDeviceIdentifier = value
})
await Promise.resolve()
assert.equal(bootstrapDeviceIdentifier, DEFAULT_RECEIVER_DEVICE_IDENTIFIER)
assert.equal(scheduledBootstrap.length, 1)
let installedBootstrapTarget
bootstrapParent.__ARIB_HTML5_INSTALL__ = target => {
  installedBootstrapTarget = target
}
scheduledBootstrap.shift()()
assert.equal(installedBootstrapTarget.navigator, bootstrapContext.navigator)
assert.equal(installedBootstrapTarget.location.origin, bootstrapContext.location.origin)
assert.equal(scheduledBootstrap.length, 0)
assert.equal(
  prepareBroadcastStylesheet('a{background:url("/sh4/a.png")} @import "/40/base.css";'),
  'a{background:url("/data-broadcast/sh4/a.png")} @import "/data-broadcast/40/base.css";',
)
