import type { ProgramInfo } from '../program-info'
import type { RuntimeApplicationInformation } from '../runtime/application-controller'
import type { RuntimeEvent } from '../runtime/stream-event'

export type RuntimeInstalledSnapshot = {
  captionComponentTags: readonly number[]
  applicationInformation: RuntimeApplicationInformation
  inputActive: boolean
  programInfo: ProgramInfo | null
}

type RuntimeSessionControllerOptions = {
  ownerWindow: Window
  iframe: HTMLIFrameElement
  origin: string
  applicationLoadTimeoutMs: number
  onApplicationLoadTimeout: (url: string) => void
}

/** Owns receiver-to-runtime transport and the runtime installation session. */
export class RuntimeSessionController {
  private readonly ownerWindow: Window
  private readonly iframe: HTMLIFrameElement
  private readonly origin: string
  private readonly applicationLoadTimeoutMs: number
  private readonly onApplicationLoadTimeout: (url: string) => void
  private readonly pendingStreamEvents: RuntimeEvent[] = []

  private activeRuntimeId: string | null = null
  private applicationLoadTimer: number | null = null
  private disposed = false

  constructor(options: RuntimeSessionControllerOptions) {
    this.ownerWindow = options.ownerWindow
    this.iframe = options.iframe
    this.origin = options.origin
    this.applicationLoadTimeoutMs = options.applicationLoadTimeoutMs
    this.onApplicationLoadTimeout = options.onApplicationLoadTimeout
  }

  get hasActiveRuntime(): boolean {
    return this.activeRuntimeId !== null && !this.disposed
  }

  matches(runtimeId: unknown): boolean {
    return !this.disposed && runtimeId === this.activeRuntimeId
  }

  acceptInstalled(
    runtimeId: string,
    snapshot: RuntimeInstalledSnapshot,
    beforeReplay?: () => void,
  ): void {
    if (this.disposed) return
    this.clearWatchdog()
    this.activeRuntimeId = runtimeId
    beforeReplay?.()
    this.postToRuntime('caption-tracks', {
      componentTags: snapshot.captionComponentTags,
    })
    this.postToRuntime('application-information', {
      value: snapshot.applicationInformation,
    })
    this.postToRuntime('receiver-input-state', {
      active: snapshot.inputActive,
    })
    if (snapshot.programInfo) {
      this.postToRuntime('program-info', { value: snapshot.programInfo })
    }
    for (const value of this.pendingStreamEvents.splice(0)) {
      this.postToRuntime('stream-event', { value })
    }
  }

  postToRuntime(event: string, detail: Record<string, unknown> = {}): void {
    if (!this.activeRuntimeId || this.disposed) return
    this.iframe.contentWindow?.postMessage({
      type: 'arib-host',
      runtimeId: this.activeRuntimeId,
      event,
      ...detail,
    }, this.origin)
  }

  emitStreamEvent(value: RuntimeEvent): void {
    if (this.disposed) return
    if (this.activeRuntimeId) {
      this.postToRuntime('stream-event', { value })
      return
    }
    if (this.pendingStreamEvents.length === 64) this.pendingStreamEvents.shift()
    this.pendingStreamEvents.push(value)
  }

  clearPendingStreamEvents(): void {
    this.pendingStreamEvents.length = 0
  }

  invalidate(): void {
    this.activeRuntimeId = null
  }

  armWatchdog(url: string): void {
    this.clearWatchdog()
    if (this.disposed || this.applicationLoadTimeoutMs === 0) return
    this.applicationLoadTimer = this.ownerWindow.setTimeout(() => {
      this.applicationLoadTimer = null
      if (this.disposed || this.activeRuntimeId) return
      this.onApplicationLoadTimeout(url)
    }, this.applicationLoadTimeoutMs)
  }

  clearWatchdog(): void {
    if (this.applicationLoadTimer === null) return
    this.ownerWindow.clearTimeout(this.applicationLoadTimer)
    this.applicationLoadTimer = null
  }

  dispose(): void {
    if (this.disposed) return
    this.clearPendingStreamEvents()
    this.clearWatchdog()
    this.invalidate()
    this.disposed = true
  }
}
