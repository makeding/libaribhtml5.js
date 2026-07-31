import {
  installRuntime,
  type ProgramInfo,
  type RuntimeEvent,
  type RuntimeWindow,
} from './runtime/install'
import {
  BehindIframeMediaPlaneAdapter,
  type AribMediaPlane,
  type AribMediaPlaneAdapter,
  type AribMediaPlaneLayer,
  type AribMediaPlaneUnmountReason,
} from './media-plane'
import {
  normalizeBroadcastBaseUrl,
  resolveBroadcastUrl,
} from './broadcast-url'
import type {
  BroadcastResourceChange,
  BroadcastResourceStore,
} from './runtime/resources'

export type {
  AribMediaPlane,
  AribMediaPlaneAdapter,
  AribMediaPlaneLayer,
  AribMediaPlaneStackEntry,
  AribMediaPlaneUnmountReason,
  AribVideoPlane,
} from './media-plane'

export type AribCaptionPacket = {
  componentTag: number
  payload?: string
  dataType?: string
  tmd?: string
  data?: string
}

export type AribBroadcastClock = {
  /** Absolute broadcast time at the anchor, as Unix epoch milliseconds. */
  epochMilliseconds: number
  /** Media timeline value which corresponds to epochMilliseconds. */
  mediaTimeSeconds?: number
  /** Current playback position; enables pause, rate, and seek aware projection. */
  currentMediaTimeSeconds?: () => number
}

export type AribReceiverHostOptions = {
  iframe: HTMLIFrameElement
  viewport: HTMLElement
  /** Surface used only by the behind-iframe compatibility adapter. */
  videoSurface?: HTMLElement
  mediaPlaneAdapter?: AribMediaPlaneAdapter
  onStatus?: (status: string) => void
  onUrlChange?: (url: string) => void
  onMediaPlane?: (plane: AribMediaPlane) => void
  /** @deprecated Use onMediaPlane. */
  onVideoPlane?: (plane: AribMediaPlane) => void
  keepVideoVisible?: boolean
  /** Allow broadcaster applications to use HTTP origins outside this host. */
  allowExternalNetwork?: boolean
  /** Same-origin namespace where a Worker or HTTP server exposes carousel data. */
  broadcastBaseUrl?: string | URL
  /** Optional bridge to a Service Worker, Cache Storage, or carousel VFS. */
  resourceStore?: BroadcastResourceStore
}

type RuntimeMessage = Record<string, unknown> & {
  type?: string
  runtimeId?: string
  event?: string
}

export class AribReceiverHost {
  readonly iframe: HTMLIFrameElement
  readonly viewport: HTMLElement
  readonly videoSurface?: HTMLElement

  private readonly ownerWindow: Window
  private readonly origin: string
  private readonly onStatus?: (status: string) => void
  private readonly onUrlChange?: (url: string) => void
  private readonly onMediaPlane?: (plane: AribMediaPlane) => void
  private readonly onVideoPlane?: (plane: AribMediaPlane) => void
  private readonly mediaPlaneAdapter?: AribMediaPlaneAdapter
  private readonly runtimeMediaPlaneAdapter?: AribMediaPlaneAdapter
  private readonly allowExternalNetwork: boolean
  private readonly broadcastBaseUrl: URL
  private readonly resourceStore?: BroadcastResourceStore
  private readonly resizeObserver: ResizeObserver
  private activeRuntimeId: string | null = null
  private logicalWidth = 3840
  private logicalHeight = 2160
  private captionComponentTags: number[] = []
  private programInfo: ProgramInfo | null = null
  private broadcastClock: (AribBroadcastClock & { monotonicMilliseconds: number }) | null = null
  private video: HTMLVideoElement | null = null
  private mediaPlaneEnabled = false
  private applicationExited = false
  private destroyed = false

  constructor(options: AribReceiverHostOptions) {
    this.iframe = options.iframe
    this.viewport = options.viewport
    this.videoSurface = options.videoSurface
    this.ownerWindow = this.iframe.ownerDocument.defaultView ?? window
    this.origin = this.ownerWindow.location.origin
    this.onStatus = options.onStatus
    this.onUrlChange = options.onUrlChange
    this.onMediaPlane = options.onMediaPlane
    this.onVideoPlane = options.onVideoPlane
    this.mediaPlaneAdapter = options.mediaPlaneAdapter ?? (options.videoSurface
      ? new BehindIframeMediaPlaneAdapter({
          surface: options.videoSurface,
          keepVisible: options.keepVideoVisible,
        })
      : undefined)
    const mediaPlaneAdapter = this.mediaPlaneAdapter
    this.runtimeMediaPlaneAdapter = mediaPlaneAdapter
      ? {
          renderMode: mediaPlaneAdapter.renderMode,
          mountMediaPlane: (object, plane) => {
            if (this.mediaPlaneEnabled && !this.destroyed) {
              mediaPlaneAdapter.mountMediaPlane(object, plane)
            }
          },
          updateMediaPlane: (object, plane) => {
            if (this.mediaPlaneEnabled && !this.destroyed) {
              mediaPlaneAdapter.updateMediaPlane(object, plane)
            }
          },
          unmountMediaPlane: (reason) => {
            if (this.mediaPlaneEnabled && !this.destroyed) {
              mediaPlaneAdapter.unmountMediaPlane(reason)
            }
          },
        }
      : undefined
    this.allowExternalNetwork = options.allowExternalNetwork ?? false
    this.broadcastBaseUrl = normalizeBroadcastBaseUrl(
      options.broadcastBaseUrl,
      this.ownerWindow.location.href,
    )
    if (this.broadcastBaseUrl.origin !== this.origin) {
      throw new Error(`Broadcast base URL must be same-origin: ${this.broadcastBaseUrl.href}`)
    }
    this.resourceStore = options.resourceStore

    this.ownerWindow.addEventListener('message', this.handleRuntimeMessage)
    this.iframe.addEventListener('load', this.handleFrameLoad)
    this.resizeObserver = new ResizeObserver(() => this.fitBroadcastCanvas())
    this.resizeObserver.observe(this.viewport)
    this.fitBroadcastCanvas()
  }

  installRuntime(target: RuntimeWindow): void {
    this.mediaPlaneEnabled = !this.destroyed && !this.applicationExited
    installRuntime(target, {
      allowExternalNetwork: this.allowExternalNetwork,
      broadcastBaseUrl: this.broadcastBaseUrl.href,
      resourceStore: this.resourceStore,
      mediaPlaneAdapter: this.runtimeMediaPlaneAdapter,
      now: () => this.getBroadcastTime(),
    })
  }

  /** @deprecated Pass an AribMediaPlaneAdapter to the constructor. */
  attachVideo(video: HTMLVideoElement): void {
    if (!this.videoSurface) {
      throw new Error('attachVideo() requires the behind-iframe videoSurface fallback')
    }
    this.video = video
    video.classList.add('broadcast-video')
    if (video.parentElement !== this.videoSurface) this.videoSurface.replaceChildren(video)
  }

  loadApplication(url: string, status = 'アプリケーション読込中'): void {
    this.assertAlive()
    const resolved = resolveBroadcastUrl(url, this.broadcastBaseUrl)
    if (resolved.origin !== this.origin) {
      throw new Error(`External broadcast application URL is not allowed: ${resolved.href}`)
    }
    this.applicationExited = false
    this.iframe.style.removeProperty('display')
    this.invalidateRuntime('document-unload')
    this.viewport.style.backgroundColor = '#fff'
    this.onStatus?.(status)
    this.onUrlChange?.(resolved.pathname)
    resolved.searchParams.set('runtime', Date.now().toString())
    this.iframe.src = resolved.href
  }

  /** Leave data-broadcast mode and restore media to the ordinary player. */
  exitApplication(status = 'データ放送終了'): void {
    this.assertAlive()
    if (this.applicationExited) return
    this.applicationExited = true
    this.invalidateRuntime('application-exit')
    this.iframe.style.display = 'none'
    this.iframe.src = 'about:blank'
    this.onUrlChange?.('')
    this.onStatus?.(status)
  }

  dispatchKey(code: number): void {
    this.assertAlive()
    const target = this.iframe.contentWindow
    if (!target) return
    try {
      for (const type of ['keydown', 'keyup']) {
        const event = new KeyboardEvent(type, { bubbles: true, cancelable: true })
        Object.defineProperties(event, {
          keyCode: { value: code },
          which: { value: code },
        })
        target.document.dispatchEvent(event)
      }
    } catch {
      this.onStatus?.('キー入力を送信できません')
    }
  }

  setCaptionTracks(componentTags: number[]): void {
    this.captionComponentTags = [...new Set(componentTags.filter(Number.isInteger))]
    this.postToRuntime('caption-tracks', { componentTags: this.captionComponentTags })
  }

  pushCaption(packet: AribCaptionPacket): void {
    this.postToRuntime('caption-data', packet)
  }

  resetCaptions(): void {
    this.captionComponentTags = []
    this.postToRuntime('caption-reset')
  }

  /** Notify a stored carousel resource after the receiver updates or removes it. */
  notifyDataResource(path: string, change: BroadcastResourceChange): void {
    this.postToRuntime('resource-change', { path, change })
  }

  setProgramInfo(value: ProgramInfo): void {
    this.programInfo = { ...value }
    this.postToRuntime('program-info', { value: this.programInfo })
  }

  /** Set a free-running broadcast clock from an absolute Unix time. */
  setBroadcastTime(value: number | Date): void {
    this.setBroadcastClock({
      epochMilliseconds: value instanceof Date ? value.getTime() : value,
    })
  }

  /** Set an absolute clock anchor, optionally projected from the media timeline. */
  setBroadcastClock(value: AribBroadcastClock): void {
    const epochMilliseconds = Number(value.epochMilliseconds)
    const mediaTimeSeconds = value.mediaTimeSeconds === undefined
      ? undefined
      : Number(value.mediaTimeSeconds)
    if (!Number.isFinite(epochMilliseconds)) {
      throw new TypeError('broadcast epochMilliseconds must be finite')
    }
    if (mediaTimeSeconds !== undefined && !Number.isFinite(mediaTimeSeconds)) {
      throw new TypeError('broadcast mediaTimeSeconds must be finite')
    }
    if (value.currentMediaTimeSeconds && mediaTimeSeconds === undefined) {
      throw new TypeError('currentMediaTimeSeconds requires mediaTimeSeconds')
    }
    this.broadcastClock = {
      ...value,
      epochMilliseconds,
      mediaTimeSeconds,
      monotonicMilliseconds: this.ownerWindow.performance.now(),
    }
  }

  clearBroadcastClock(): void {
    this.broadcastClock = null
  }

  getBroadcastTime(): number {
    const clock = this.broadcastClock
    if (!clock) return Date.now()
    if (clock.currentMediaTimeSeconds && clock.mediaTimeSeconds !== undefined) {
      const currentMediaTime = Number(clock.currentMediaTimeSeconds())
      if (Number.isFinite(currentMediaTime)) {
        return clock.epochMilliseconds +
          (currentMediaTime - clock.mediaTimeSeconds) * 1000
      }
    }
    return clock.epochMilliseconds +
      (this.ownerWindow.performance.now() - clock.monotonicMilliseconds)
  }

  emitStreamEvent(value: RuntimeEvent): void {
    this.postToRuntime('stream-event', { value })
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.ownerWindow.removeEventListener('message', this.handleRuntimeMessage)
    this.iframe.removeEventListener('load', this.handleFrameLoad)
    this.resizeObserver.disconnect()
    this.invalidateRuntime('host-destroy')
    this.video = null
  }

  private readonly handleFrameLoad = (): void => {
    if (this.applicationExited) return
    try {
      if (this.iframe.contentWindow?.location.origin === this.origin) return
    } catch {
      // A cross-origin page cannot participate in this receiver session.
    }
    this.invalidateRuntime('document-unload')
    this.onStatus?.('通信ページをブロックしました')
  }

  private readonly handleRuntimeMessage = (event: MessageEvent): void => {
    if (event.origin !== this.origin) return
    const message = event.data as RuntimeMessage
    if (message?.type !== 'arib-runtime' || typeof message.runtimeId !== 'string') return

    if (message.event === 'installed') {
      this.activeRuntimeId = message.runtimeId
      this.onUrlChange?.(String(message.url ?? ''))
      this.postToRuntime('caption-tracks', { componentTags: this.captionComponentTags })
      if (this.programInfo) this.postToRuntime('program-info', { value: this.programInfo })
      this.onStatus?.('ランタイム導入済み')
      return
    }
    if (message.runtimeId !== this.activeRuntimeId) return

    switch (message.event) {
      case 'unloading':
        this.invalidateRuntime('document-unload')
        this.onStatus?.('ページ遷移中')
        return
      case 'navigation-blocked':
        this.onStatus?.('外部URLをブロックしました')
        this.onUrlChange?.(String(message.url ?? ''))
        return
      case 'stage-style': {
        const color = String(message.backgroundColor ?? '')
        if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
          this.viewport.style.backgroundColor = color
        }
        return
      }
      case 'media-plane':
      case 'video-plane':
        this.applyMediaPlane(message)
        return
      case 'destroy':
        this.exitApplication('アプリケーション終了')
        return
      case 'error':
        this.onStatus?.(`ランタイムエラー：${String(message.message ?? '')}`)
        return
      default:
        this.onStatus?.(`ランタイム：${String(message.event ?? '')}`)
    }
  }

  private applyMediaPlane(message: RuntimeMessage): void {
    if (!message.visible) {
      const plane: AribMediaPlane = {
        slotId: String(message.slotId ?? ''),
        visible: false,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        screenWidth: this.logicalWidth,
        screenHeight: this.logicalHeight,
        layer: this.readMediaLayer(message.layer),
      }
      this.onMediaPlane?.(plane)
      this.onVideoPlane?.(plane)
      return
    }
    const plane: AribMediaPlane = {
      slotId: String(message.slotId ?? ''),
      visible: true,
      x: Number(message.x) || 0,
      y: Number(message.y) || 0,
      width: Number(message.width) || 0,
      height: Number(message.height) || 0,
      screenWidth: Number(message.screenWidth) || 3840,
      screenHeight: Number(message.screenHeight) || 2160,
      videoSource: typeof message.videoSource === 'string' ? message.videoSource : undefined,
      audioSource: typeof message.audioSource === 'string' ? message.audioSource : undefined,
      layer: this.readMediaLayer(message.layer),
    }
    this.logicalWidth = plane.screenWidth
    this.logicalHeight = plane.screenHeight
    this.viewport.style.aspectRatio = `${this.logicalWidth} / ${this.logicalHeight}`
    this.fitBroadcastCanvas()
    this.onStatus?.(`映像 ${Math.round(plane.width)}×${Math.round(plane.height)}` +
      ` / 位置 ${Math.round(plane.x)},${Math.round(plane.y)}`)
    this.onMediaPlane?.(plane)
    this.onVideoPlane?.(plane)
  }

  private readMediaLayer(value: unknown): AribMediaPlaneLayer {
    if (!value || typeof value !== 'object') {
      return { documentOrder: -1, stackingPath: [] }
    }
    const layer = value as Partial<AribMediaPlaneLayer>
    return {
      documentOrder: Number(layer.documentOrder) || 0,
      stackingPath: Array.isArray(layer.stackingPath) ? layer.stackingPath : [],
    }
  }

  private postToRuntime(event: string, detail: Record<string, unknown> = {}): void {
    if (!this.activeRuntimeId) return
    this.iframe.contentWindow?.postMessage({
      type: 'arib-host',
      runtimeId: this.activeRuntimeId,
      event,
      ...detail,
    }, this.origin)
  }

  private invalidateRuntime(reason: AribMediaPlaneUnmountReason): void {
    this.activeRuntimeId = null
    this.mediaPlaneEnabled = false
    this.mediaPlaneAdapter?.unmountMediaPlane(reason)
  }

  private fitBroadcastCanvas(): void {
    const scale = Math.min(
      this.viewport.clientWidth / this.logicalWidth,
      this.viewport.clientHeight / this.logicalHeight,
    )
    this.iframe.style.width = `${this.logicalWidth}px`
    this.iframe.style.height = `${this.logicalHeight}px`
    this.iframe.style.transform = `scale(${scale})`
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error('AribReceiverHost has been destroyed')
  }
}
