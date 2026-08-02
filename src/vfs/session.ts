import type {
  BroadcastVfsBackend,
  BroadcastVfsResource,
  BroadcastVfsSessionOptions,
} from './types.ts'

type QueuedResource = {
  revision: number
  generation: number
  resource: BroadcastVfsResource
}

type RevisionWaiter = {
  revision: number
  resolve: () => void
}

function copyResource(resource: BroadcastVfsResource): BroadcastVfsResource {
  const source = resource.data instanceof Uint8Array
    ? resource.data
    : new Uint8Array(resource.data)
  return {
    path: String(resource.path).replace(/^\/+/, ''),
    contentType: resource.contentType ?? '',
    data: source.slice(),
  }
}

/**
 * Ordered, recoverable write session above a VFS backend. enqueue() copies
 * callback-lifetime data synchronously and returns a revision barrier.
 */
export class BroadcastVfsSession {
  private readonly backend: BroadcastVfsBackend
  private readonly onError?: (error: unknown) => void
  private readonly scheduleTask: (task: () => void) => void
  private readonly mirror = new Map<string, BroadcastVfsResource>()
  private readonly queue: QueuedResource[] = []
  private waiters: RevisionWaiter[] = []
  private generation = 0
  private nextRevision = 0
  private completedRevision = 0
  private drainScheduled = false
  private ioTail: Promise<void> = Promise.resolve()
  private sessionReady: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(backend: BroadcastVfsBackend, options: BroadcastVfsSessionOptions = {}) {
    this.backend = backend
    this.onError = options.onError
    this.scheduleTask = options.schedule ?? ((task) => {
      const scheduler = (globalThis as typeof globalThis & {
        scheduler?: {
          postTask(callback: () => void, options?: { priority: 'background' }): Promise<unknown>
        }
      }).scheduler
      if (scheduler) {
        void scheduler.postTask(task, { priority: 'background' })
          .catch(error => this.onError?.(error))
      } else {
        globalThis.setTimeout(task, 0)
      }
    })
  }

  beginSession(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Broadcast VFS session is disposed'))
    this.generation += 1
    this.queue.splice(0)
    this.mirror.clear()
    this.completedRevision = this.nextRevision
    this.resolveWaiters()
    this.sessionReady = this.appendIo(() => this.backend.begin())
    return this.sessionReady
  }

  enqueue(resource: BroadcastVfsResource): number {
    if (this.disposed) throw new Error('Broadcast VFS session is disposed')
    const owned = copyResource(resource)
    const revision = ++this.nextRevision
    this.mirror.set(owned.path, owned)
    this.queue.push({ revision, generation: this.generation, resource: owned })
    this.scheduleDrain()
    return revision
  }

  waitFor(revision: number): Promise<void> {
    if (this.completedRevision >= revision) return Promise.resolve()
    return new Promise(resolve => this.waiters.push({ revision, resolve }))
  }

  /** Ensure a staged path is readable, replaying the page-owned mirror if needed. */
  async ensure(path: string, revision = this.nextRevision): Promise<void> {
    if (this.disposed) throw new Error('Broadcast VFS session is disposed')
    const generation = this.generation
    const normalizedPath = String(path).replace(/^\/+/, '')
    await this.waitFor(revision)
    await this.sessionReady
    if (generation !== this.generation) throw new Error('Broadcast VFS session changed')
    await this.appendIo(async () => {
      if (await this.backend.canRead(normalizedPath)) return
      await this.backend.begin()
      for (const resource of this.mirror.values()) await this.backend.put(resource)
      if (!await this.backend.canRead(normalizedPath)) {
        throw new Error(`Broadcast VFS resource is not available: /${normalizedPath}`)
      }
    })
  }

  /**
   * Stop accepting resources, discard queued writes, and wait for the one
   * backend operation which may already be running. The backend itself remains
   * owned by the caller and can be reset or disposed after this resolves.
   */
  async dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true
      this.generation += 1
      this.queue.splice(0)
      this.mirror.clear()
      this.completedRevision = this.nextRevision
      this.resolveWaiters()
    }
    await this.ioTail
  }

  private appendIo(operation: () => Promise<void>): Promise<void> {
    const result = this.ioTail.then(operation, operation)
    this.ioTail = result.then(() => undefined, () => undefined)
    return result
  }

  private scheduleDrain(): void {
    if (this.drainScheduled || !this.queue.length) return
    this.drainScheduled = true
    this.scheduleTask(() => {
      this.drainScheduled = false
      void this.drainOne()
    })
  }

  private async drainOne(): Promise<void> {
    const item = this.queue.shift()
    if (!item) return
    try {
      await this.sessionReady
      if (item.generation === this.generation) {
        await this.appendIo(() => this.backend.put(item.resource))
      }
    } catch (error) {
      this.onError?.(error)
    } finally {
      this.completedRevision = Math.max(this.completedRevision, item.revision)
      this.resolveWaiters()
      this.scheduleDrain()
    }
  }

  private resolveWaiters(): void {
    const pending = this.waiters
    this.waiters = []
    for (const waiter of pending) {
      if (this.completedRevision >= waiter.revision) waiter.resolve()
      else this.waiters.push(waiter)
    }
  }
}
