import type {
  BroadcastVfsResource,
  ServiceWorkerBroadcastVfsOptions,
} from './types.ts'

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
