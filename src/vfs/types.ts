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
