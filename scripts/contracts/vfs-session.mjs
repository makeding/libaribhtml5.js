import assert from 'node:assert/strict'

import { BroadcastVfsSession } from '../../src/service-worker-vfs.ts'

const vfsFiles = new Map()
let vfsBegins = 0
const vfsBackend = {
  async begin() {
    vfsBegins += 1
    vfsFiles.clear()
  },
  async put(resource) {
    vfsFiles.set(resource.path, Uint8Array.from(resource.data))
  },
  async canRead(path) {
    return vfsFiles.has(path)
  },
}
const vfsSession = new BroadcastVfsSession(vfsBackend, {
  schedule: task => queueMicrotask(task),
})
await vfsSession.beginSession()
const callbackLifetimeData = new Uint8Array([1, 2, 3])
const revision = vfsSession.enqueue({
  path: '/carousel/index.html',
  data: callbackLifetimeData,
})
callbackLifetimeData[0] = 99
await vfsSession.waitFor(revision)
assert.deepEqual([...vfsFiles.get('carousel/index.html')], [1, 2, 3])

// Simulate Worker memory reclamation. ensure() owns the ordered mirror replay.
vfsFiles.clear()
await vfsSession.ensure('carousel/index.html', revision)
assert.equal(vfsBegins, 2)
assert.deepEqual([...vfsFiles.get('carousel/index.html')], [1, 2, 3])

// dispose() waits for an active write but prevents queued resources from
// repopulating a backend after its owner resets the VFS.
let releaseActiveWrite
let activeWriteStarted
const activeWriteGate = new Promise(resolve => { releaseActiveWrite = resolve })
const activeWriteSignal = new Promise(resolve => { activeWriteStarted = resolve })
const disposedFiles = new Map()
const disposableSession = new BroadcastVfsSession({
  async begin() {
    disposedFiles.clear()
  },
  async put(resource) {
    activeWriteStarted()
    await activeWriteGate
    disposedFiles.set(resource.path, Uint8Array.from(resource.data))
  },
  async canRead(path) {
    return disposedFiles.has(path)
  },
}, {
  schedule: task => queueMicrotask(task),
})
await disposableSession.beginSession()
disposableSession.enqueue({ path: 'active.bin', data: new Uint8Array([1]) })
disposableSession.enqueue({ path: 'queued.bin', data: new Uint8Array([2]) })
await activeWriteSignal
const disposingSession = disposableSession.dispose()
releaseActiveWrite()
await disposingSession
assert.equal(disposedFiles.has('active.bin'), true)
assert.equal(disposedFiles.has('queued.bin'), false)
assert.throws(
  () => disposableSession.enqueue({ path: 'late.bin', data: new Uint8Array([3]) }),
  /disposed/,
)
await assert.rejects(disposableSession.beginSession(), /disposed/)
