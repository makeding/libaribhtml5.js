type CaptionListener = (data: string) => void

type BroadcastObject = HTMLElement & {
  isCaptionExistent?: (source: string) => boolean
  addCaptionListener?: (listener: CaptionListener, source: string) => boolean
  removeCaptionListener?: (listener: CaptionListener) => boolean
}

type RuntimeCaptionControllerOptions = {
  requirePermission: () => void
  postRuntime: (event: string, detail?: Record<string, unknown>) => void
}

type RuntimeCaptionMessage = {
  event?: unknown
  componentTags?: Iterable<unknown> | null
  componentTag?: unknown
  payload?: unknown
  dataType?: unknown
  tmd?: unknown
  data?: unknown
}

/** Owns the document-side caption tracks, subscriptions, and broadcast object API. */
export class RuntimeCaptionController {
  private readonly requirePermission: () => void
  private readonly postRuntime: (
    event: string,
    detail?: Record<string, unknown>,
  ) => void
  private readonly tracks = new Set<number>()
  private readonly listeners = new Map<CaptionListener, number>()

  constructor(options: RuntimeCaptionControllerOptions) {
    this.requirePermission = options.requirePermission
    this.postRuntime = options.postRuntime
  }

  readonly installBroadcastObjectApi = (element: HTMLElement): void => {
    const object = element as BroadcastObject
    if (typeof object.isCaptionExistent !== 'function') {
      object.isCaptionExistent = (source: string) => {
        this.requirePermission()
        const componentTag = this.componentTag(source)
        return componentTag !== null && this.tracks.has(componentTag)
      }
    }
    if (typeof object.addCaptionListener !== 'function') {
      object.addCaptionListener = (listener: CaptionListener, source: string) => {
        this.requirePermission()
        const componentTag = this.componentTag(source)
        if (typeof listener !== 'function' || componentTag === null) return false
        this.listeners.set(listener, componentTag)
        this.reportSubscriptions()
        return true
      }
    }
    if (typeof object.removeCaptionListener !== 'function') {
      object.removeCaptionListener = (listener: CaptionListener) => {
        this.requirePermission()
        const removed = this.listeners.delete(listener)
        if (removed) this.reportSubscriptions()
        return removed
      }
    }
  }

  /** Handle a host caption event; return false when it belongs to another subsystem. */
  handleHostMessage(message: RuntimeCaptionMessage): boolean {
    if (message.event === 'caption-tracks') {
      this.tracks.clear()
      for (const value of message.componentTags ?? []) {
        const componentTag = Number(value)
        if (Number.isInteger(componentTag)) this.tracks.add(componentTag)
      }
      return true
    }
    if (message.event === 'caption-reset') {
      this.tracks.clear()
      this.listeners.clear()
      this.reportSubscriptions()
      return true
    }
    if (message.event === 'caption-data') {
      const componentTag = Number(message.componentTag)
      const payload = typeof message.payload === 'string'
        ? message.payload
        : JSON.stringify({
            data_type: String(message.dataType ?? '0000'),
            TMD: String(message.tmd ?? ''),
            data: String(message.data ?? ''),
          })
      for (const [listener, registeredTag] of this.listeners) {
        if (registeredTag === componentTag) listener(payload)
      }
      return true
    }
    return false
  }

  private componentTag(source: string): number | null {
    const value = source.match(/\/([0-9a-f]{4})(?:[?#]|$)/i)?.[1]
    return value === undefined ? null : Number.parseInt(value, 16)
  }

  private reportSubscriptions(): void {
    this.postRuntime('caption-subscription', {
      componentTags: [...new Set(this.listeners.values())],
    })
  }
}
