export type BroadcastVfsResource = {
  path: string
  contentType?: string
  data: Uint8Array | ArrayBuffer
}

export type ServiceWorkerBroadcastVfsOptions = {
  workerUrl: string | URL
  /** Same-origin scope used to expose broadcast files. */
  baseUrl?: string | URL
  /** Compatibility fallback for applications which omit a carousel directory. */
  uniqueBasenameFallback?: boolean
}

export type BroadcastVfsBackend = {
  begin(): Promise<void>
  put(resource: BroadcastVfsResource): Promise<void>
  canRead(path: string): Promise<boolean>
}

export type BroadcastVfsSessionOptions = {
  /** Report background write failures; ensure() still rejects to its caller. */
  onError?: (error: unknown) => void
  /** Override background scheduling, primarily for embedded hosts and tests. */
  schedule?: (task: () => void) => void
}

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

type VfsReply = {
  ok?: boolean
  available?: boolean
  error?: string
}

export class ServiceWorkerBroadcastVfs {
  private readonly workerUrl: URL
  private readonly scopeUrl: URL
  private readonly uniqueBasenameFallback: boolean
  private registration: ServiceWorkerRegistration | null = null
  private ready: Promise<ServiceWorkerRegistration> | null = null
  private readonly inFlight = new Set<Promise<VfsReply>>()
  private disposing: Promise<void> | null = null
  private disposed = false

  constructor(options: ServiceWorkerBroadcastVfsOptions) {
    this.workerUrl = new URL(options.workerUrl, window.location.href)
    this.scopeUrl = new URL(options.baseUrl ?? '/data-broadcast/', window.location.href)
    if (this.workerUrl.origin !== window.location.origin ||
        this.scopeUrl.origin !== window.location.origin) {
      throw new TypeError('Broadcast VFS worker and base URL must be same-origin')
    }
    if (!this.scopeUrl.pathname.endsWith('/')) this.scopeUrl.pathname += '/'
    this.scopeUrl.search = ''
    this.scopeUrl.hash = ''
    this.uniqueBasenameFallback = options.uniqueBasenameFallback ?? false
  }

  initialize(): Promise<ServiceWorkerRegistration> {
    if (this.disposed || this.disposing) {
      return Promise.reject(new Error('Broadcast VFS backend is disposed'))
    }
    if (this.ready) return this.ready
    this.ready = (async () => {
      if (!('serviceWorker' in navigator)) {
        throw new Error('This browser does not support Service Worker')
      }
      for (const previous of await navigator.serviceWorker.getRegistrations()) {
        const scriptUrl = previous.active?.scriptURL ?? previous.waiting?.scriptURL ??
          previous.installing?.scriptURL
        if (scriptUrl === this.workerUrl.href && previous.scope !== this.scopeUrl.href) {
          await previous.unregister()
        }
      }
      this.registration = await navigator.serviceWorker.register(this.workerUrl.href, {
        scope: this.scopeUrl.pathname,
        updateViaCache: 'none',
      })
      await this.registration.update()
      const pending = this.registration.installing ?? this.registration.waiting
      if (pending && pending.state !== 'activated') await this.waitForActivation(pending)
      if (!this.registration.active) throw new Error('Broadcast VFS worker did not activate')
      return this.registration
    })()
    return this.ready
  }

  async begin(): Promise<void> {
    await this.request({
      type: 'arib-vfs-begin',
      uniqueBasenameFallback: this.uniqueBasenameFallback,
    })
  }

  async put(resource: BroadcastVfsResource): Promise<void> {
    const source = resource.data instanceof Uint8Array
      ? resource.data
      : new Uint8Array(resource.data)
    const owned = source.slice()
    await this.request({
      type: 'arib-vfs-put',
      path: resource.path,
      contentType: resource.contentType ?? '',
      data: owned.buffer,
    }, [owned.buffer])
  }

  async canRead(path: string): Promise<boolean> {
    const response = await this.request({
      type: 'arib-vfs-probe',
      path: String(path).replace(/^\/+/, ''),
    })
    return response.available === true
  }

  async reset(): Promise<void> {
    await this.request({ type: 'arib-vfs-reset' })
  }

  /**
   * Clear the receiver-owned VFS session after outstanding requests finish.
   * The shared Service Worker registration is intentionally retained so other
   * tabs and future receiver instances keep a stable scoped fetch handler.
   */
  dispose(): Promise<void> {
    if (this.disposing) return this.disposing
    if (this.disposed) return Promise.resolve()
    this.disposing = (async () => {
      await Promise.allSettled([...this.inFlight])
      // No registration means this instance never created VFS state. Avoid
      // registering a worker solely to tear an unused backend down.
      if (this.registration) {
        await this.performRequestWithRegistration(
          this.registration,
          { type: 'arib-vfs-reset' },
        )
      }
      this.registration = null
      this.ready = null
      this.disposed = true
    })()
    return this.disposing
  }

  private request(
    message: Record<string, unknown>,
    transfer: Transferable[] = [],
  ): Promise<VfsReply> {
    if (this.disposed || this.disposing) {
      return Promise.reject(new Error('Broadcast VFS backend is disposed'))
    }
    const operation = this.performRequest(message, transfer)
    this.inFlight.add(operation)
    void operation.finally(() => this.inFlight.delete(operation)).catch(() => undefined)
    return operation
  }

  private async performRequest(
    message: Record<string, unknown>,
    transfer: Transferable[] = [],
  ): Promise<VfsReply> {
    const registration = await this.initialize()
    return this.performRequestWithRegistration(registration, message, transfer)
  }

  private async performRequestWithRegistration(
    registration: ServiceWorkerRegistration,
    message: Record<string, unknown>,
    transfer: Transferable[] = [],
  ): Promise<VfsReply> {
    const worker = registration.active ?? registration.waiting ?? registration.installing
    if (!worker) throw new Error('Broadcast VFS worker is unavailable')
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel()
      const timeout = window.setTimeout(() => {
        channel.port1.close()
        reject(new Error('Broadcast VFS worker did not respond'))
      }, 5000)
      channel.port1.onmessage = (event: MessageEvent<VfsReply>) => {
        window.clearTimeout(timeout)
        channel.port1.close()
        if (event.data?.ok) resolve(event.data)
        else reject(new Error(event.data?.error || 'Broadcast VFS worker error'))
      }
      worker.postMessage(message, [channel.port2, ...transfer])
    })
  }

  private waitForActivation(worker: ServiceWorker): Promise<void> {
    return new Promise(resolve => {
      const timeout = window.setTimeout(() => {
        worker.removeEventListener('statechange', changed)
        resolve()
      }, 15000)
      const changed = () => {
        if (worker.state !== 'activated' && worker.state !== 'redundant') return
        window.clearTimeout(timeout)
        worker.removeEventListener('statechange', changed)
        resolve()
      }
      worker.addEventListener('statechange', changed)
    })
  }
}
