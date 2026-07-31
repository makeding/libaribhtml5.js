export type BroadcastResourceChange = 'updated' | 'deleted'
export type BroadcastResourceCacheEvent =
  | 'store_finished'
  | 'store_failed'
  | BroadcastResourceChange

export type BroadcastResourceStore = {
  /** Resolve and retain a complete carousel resource. */
  store: (url: string, options: { signal: AbortSignal }) => Promise<void>
  /** Drop receiver-managed state for a previously retained resource. */
  release?: (url: string) => void | Promise<void>
}

export type BroadcastResourceCacheListener = (
  path: string,
  event: BroadcastResourceCacheEvent,
) => void

type RuntimeWindow = Window & typeof globalThis

type ResourceEntry = {
  url: string
  paths: Set<string>
  state: 'loading' | 'stored' | 'failed'
  controller?: AbortController
  generation: number
}

export type BroadcastResourceCache = {
  addListener: (path: string, listener: BroadcastResourceCacheListener) => boolean
  removeListener: (path: string, listener?: BroadcastResourceCacheListener) => boolean
  store: (path: string, listener?: BroadcastResourceCacheListener) => boolean
  release: (path?: string) => boolean
  change: (path: string, event: BroadcastResourceChange) => void
  dispose: () => void
}

export function createBroadcastResourceCache(
  target: RuntimeWindow,
  resolve: (path: string) => URL,
  configuredStore?: BroadcastResourceStore,
): BroadcastResourceCache {
  const store = configuredStore ?? {
    async store(url: string, options: { signal: AbortSignal }) {
      const response = await target.fetch(url, {
        cache: 'reload',
        credentials: 'same-origin',
        signal: options.signal,
      })
      if (!response.ok) throw new Error(`Broadcast resource returned HTTP ${response.status}`)
      // Resolving headers is not enough: store_finished means the complete
      // resource is available to the receiver/Worker cache.
      await response.arrayBuffer()
    },
  } satisfies BroadcastResourceStore

  const listeners = new Map<string, Set<BroadcastResourceCacheListener>>()
  const resources = new Map<string, ResourceEntry>()
  let disposed = false

  const canonicalUrl = (path: string) => resolve(path).href
  const notify = (
    path: string,
    listener: BroadcastResourceCacheListener,
    event: BroadcastResourceCacheEvent,
  ) => target.queueMicrotask(() => listener(path, event))
  const notifyEntry = (entry: ResourceEntry, event: BroadcastResourceCacheEvent) => {
    for (const path of entry.paths) {
      for (const listener of listeners.get(path) ?? []) notify(path, listener, event)
    }
  }
  const callRelease = (url: string) => {
    try {
      void Promise.resolve(store.release?.(url)).catch(() => undefined)
    } catch {
      // releaseDataResource() is synchronous; adapter cleanup remains best-effort.
    }
  }
  const discard = (entry: ResourceEntry) => {
    entry.generation += 1
    entry.controller?.abort()
    entry.controller = undefined
    resources.delete(entry.url)
    callRelease(entry.url)
  }
  const load = (entry: ResourceEntry, successEvent: BroadcastResourceCacheEvent) => {
    entry.controller?.abort()
    const controller = new target.AbortController()
    const generation = ++entry.generation
    entry.controller = controller
    entry.state = 'loading'
    void Promise.resolve(store.store(entry.url, { signal: controller.signal })).then(
      () => {
        if (disposed || controller.signal.aborted || entry.generation !== generation) return
        entry.controller = undefined
        entry.state = 'stored'
        notifyEntry(entry, successEvent)
      },
      () => {
        if (disposed || controller.signal.aborted || entry.generation !== generation) return
        entry.controller = undefined
        entry.state = 'failed'
        notifyEntry(entry, 'store_failed')
      },
    )
  }

  const addListener = (path: string, listener: BroadcastResourceCacheListener) => {
    if (typeof listener !== 'function' || disposed) return false
    if (!listeners.has(path)) listeners.set(path, new Set())
    listeners.get(path)?.add(listener)
    const entry = resources.get(canonicalUrl(path))
    if (entry?.state === 'stored') notify(path, listener, 'store_finished')
    return true
  }

  const release = (path?: string) => {
    if (path === undefined) {
      for (const entry of [...resources.values()]) discard(entry)
      return true
    }
    const entry = resources.get(canonicalUrl(path))
    if (entry) discard(entry)
    return true
  }

  return {
    addListener,
    removeListener(path, listener) {
      if (listener) {
        listeners.get(path)?.delete(listener)
        if (listeners.get(path)?.size === 0) listeners.delete(path)
      } else {
        listeners.delete(path)
      }
      return true
    },
    store(path, listener) {
      if (disposed) return false
      const url = canonicalUrl(path)
      let entry = resources.get(url)
      if (!entry) {
        entry = {
          url,
          paths: new Set(),
          state: 'failed',
          generation: 0,
        }
        resources.set(url, entry)
      }
      entry.paths.add(path)
      if (listener) addListener(path, listener)
      if (entry.state === 'stored') {
        // addListener() above reports the already-complete resource.
      } else if (entry.state !== 'loading') {
        load(entry, 'store_finished')
      }
      return true
    },
    release,
    change(path, event) {
      const entry = resources.get(canonicalUrl(path))
      if (!entry) return
      if (event === 'deleted') {
        notifyEntry(entry, 'deleted')
        discard(entry)
      } else {
        load(entry, 'updated')
      }
    },
    dispose() {
      if (disposed) return
      release()
      disposed = true
      listeners.clear()
    },
  }
}
