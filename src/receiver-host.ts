import {
  installRuntime,
  type RuntimeApplicationInformation,
  type RuntimeEvent,
  type RuntimeWindow,
} from './runtime/install'
import { makeIframePointerTransparent } from './iframe-input'
import { cloneProgramInfo, type ProgramInfo } from './program-info'
import type { ReceiverSystemInformationOverrides } from './runtime/system-information'
import type { ReceiverDeviceIdentifierProvider } from './device-identifier'
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
import {
  dispatchProgramGuideRequest,
  type AribProgramGuideHandler,
  type AribProgramGuideRequest,
  type AribProgramGuideUnavailableEvent,
  type AribProgramGuideUnavailableHandler,
} from './program-guide'

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

export type AribCaptionSubscription = {
  componentTags: number[]
}

export type AribApplicationInformation = RuntimeApplicationInformation

export type AribApplicationReplaceRequest = {
  organizationId: number
  applicationId: number
  aitUrl: string | null
}

export type AribApplicationReplaceHandler = (
  request: AribApplicationReplaceRequest,
) => void | Promise<void>

export type AribExitManagedStateHandler = (url: string) => void | Promise<void>

export type AribBroadcastClock = {
  /** Absolute broadcast time at the anchor, as Unix epoch milliseconds. */
  epochMilliseconds: number
  /** Media timeline value which corresponds to epochMilliseconds. */
  mediaTimeSeconds?: number
  /** Current playback position; enables pause, rate, and seek aware projection. */
  currentMediaTimeSeconds?: () => number
}

export type AribReceiverLifecycleEvent =
  | { type: 'loading'; url: string }
  | { type: 'installed'; url: string; runtimeId: string }
  | { type: 'navigating'; url: string }
  | { type: 'exited' }
  | { type: 'navigation-blocked'; url: string }
  | { type: 'frame-blocked'; url: string }
  | { type: 'error'; message: string }

export type AribReceiverHostOptions = {
  iframe: HTMLIFrameElement
  viewport: HTMLElement
  /** Surface used only by the behind-iframe compatibility adapter. */
  videoSurface?: HTMLElement
  mediaPlaneAdapter?: AribMediaPlaneAdapter
  onStatus?: (status: string) => void
  /** Machine-readable application/runtime lifecycle; never branch on onStatus text. */
  onLifecycle?: (event: AribReceiverLifecycleEvent) => void
  /** Time to wait for a loaded document to install the receiver runtime. 0 disables the fallback. */
  applicationLoadTimeoutMs?: number
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
  /** Receiver/WebView bridge which opens the native EPG or a program detail page. */
  onOpenProgramGuide?: AribProgramGuideHandler
  /** Active caption components requested by the current broadcast document. */
  onCaptionSubscription?: (subscription: AribCaptionSubscription) => void
  /** Resolve Application.replaceApplication() through the receiver's current MH-AIT. */
  onReplaceApplication?: AribApplicationReplaceHandler
  /** Transfer an application to an unmanaged general-application URL. */
  onExitManagedState?: AribExitManagedStateHandler
  /** Override the default browser alert when the receiver cannot open the EPG. */
  onProgramGuideUnavailable?: AribProgramGuideUnavailableHandler
  /** Receiver identity/capabilities exposed to the broadcast application. */
  systemInformation?: ReceiverSystemInformationOverrides
  /** Resolve receiver/CAS identifiers; defaults to the bundled Huggy demo identity. */
  getDeviceIdentifier?: ReceiverDeviceIdentifierProvider
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
  private readonly onLifecycle?: (event: AribReceiverLifecycleEvent) => void
  private readonly applicationLoadTimeoutMs: number
  private readonly onUrlChange?: (url: string) => void
  private readonly onMediaPlane?: (plane: AribMediaPlane) => void
  private readonly onVideoPlane?: (plane: AribMediaPlane) => void
  private readonly mediaPlaneAdapter?: AribMediaPlaneAdapter
  private readonly runtimeMediaPlaneAdapter?: AribMediaPlaneAdapter
  private readonly allowExternalNetwork: boolean
  private readonly broadcastBaseUrl: URL
  private readonly resourceStore?: BroadcastResourceStore
  private readonly onOpenProgramGuide?: AribProgramGuideHandler
  private readonly onCaptionSubscription?: (subscription: AribCaptionSubscription) => void
  private readonly onReplaceApplication?: AribApplicationReplaceHandler
  private readonly onExitManagedState?: AribExitManagedStateHandler
  private readonly onProgramGuideUnavailable?: AribProgramGuideUnavailableHandler
  private readonly systemInformation?: ReceiverSystemInformationOverrides
  private readonly getDeviceIdentifier?: ReceiverDeviceIdentifierProvider
  private readonly resizeObserver: ResizeObserver
  private activeRuntimeId: string | null = null
  private logicalWidth = 3840
  private logicalHeight = 2160
  private captionComponentTags: number[] = []
  private applicationInformation: AribApplicationInformation = {}
  private programInfo: ProgramInfo | null = null
  private readonly pendingStreamEvents: RuntimeEvent[] = []
  private broadcastClock: (AribBroadcastClock & { monotonicMilliseconds: number }) | null = null
  private video: HTMLVideoElement | null = null
  private mediaPlaneEnabled = false
  private applicationExited = false
  private applicationLoadTimer: number | null = null
  private destroyed = false

  constructor(options: AribReceiverHostOptions) {
    this.iframe = options.iframe
    this.viewport = options.viewport
    this.videoSurface = options.videoSurface
    // The broadcast application is a visual plane. Receiver keys are injected
    // through dispatchKey(), so the full-size iframe must not consume pointer
    // input intended for the player controls underneath it (especially on
    // touch devices where even a transparent iframe wins hit testing).
    makeIframePointerTransparent(this.iframe)
    this.ownerWindow = this.iframe.ownerDocument.defaultView ?? window
    this.origin = this.ownerWindow.location.origin
    this.onStatus = options.onStatus
    this.onLifecycle = options.onLifecycle
    this.applicationLoadTimeoutMs = options.applicationLoadTimeoutMs ?? 5000
    if (!Number.isFinite(this.applicationLoadTimeoutMs) || this.applicationLoadTimeoutMs < 0) {
      throw new TypeError('applicationLoadTimeoutMs must be a finite non-negative number')
    }
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
    this.onOpenProgramGuide = options.onOpenProgramGuide
    this.onCaptionSubscription = options.onCaptionSubscription
    this.onReplaceApplication = options.onReplaceApplication
    this.onExitManagedState = options.onExitManagedState
    this.onProgramGuideUnavailable = options.onProgramGuideUnavailable
    this.systemInformation = options.systemInformation
    this.getDeviceIdentifier = options.getDeviceIdentifier

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
      systemInformation: this.systemInformation,
      getDeviceIdentifier: this.getDeviceIdentifier,
      application: this.applicationInformation,
    })
  }

  /** Set the MH-AIT identity exposed by applicationManager.getOwnerApplication(). */
  setApplicationInformation(application: AribApplicationInformation | null): void {
    this.assertAlive()
    this.applicationInformation = application ? { ...application } : {}
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
    // The receiver-owned background plane remains below an external video
    // surface. It must not be moved into the iframe, where it would cover the
    // video together with the application canvas.
    this.viewport.style.backgroundColor = '#000'
    this.onStatus?.(status)
    this.onUrlChange?.(resolved.pathname)
    this.onLifecycle?.({ type: 'loading', url: resolved.href })
    resolved.searchParams.set('runtime', Date.now().toString())
    this.iframe.src = resolved.href
    this.armApplicationLoadTimer(resolved.href)
  }

  /** Leave data-broadcast mode and restore media to the ordinary player. */
  exitApplication(status = 'データ放送終了'): void {
    this.assertAlive()
    if (this.applicationExited) return
    this.applicationExited = true
    this.pendingStreamEvents.length = 0
    this.clearApplicationLoadTimer()
    this.invalidateRuntime('application-exit')
    this.iframe.style.display = 'none'
    this.iframe.src = 'about:blank'
    this.onUrlChange?.('')
    this.onStatus?.(status)
    this.onLifecycle?.({ type: 'exited' })
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
    this.programInfo = cloneProgramInfo(value)
    this.postToRuntime('program-info', { value: this.programInfo })
  }

  /** Clear stale EIT state while changing services or broadcast sessions. */
  clearProgramInfo(): void {
    this.programInfo = null
    this.postToRuntime('program-info', { value: null })
  }

  /**
   * Ask the receiver host to open its EPG. A WebView host can bridge this to a
   * native activity; an ordinary browser receives a clear unsupported notice.
   */
  openProgramGuide(request: AribProgramGuideRequest = {
    destination: 'program-guide',
  }): Promise<boolean> {
    this.assertAlive()
    return dispatchProgramGuideRequest(
      request,
      this.onOpenProgramGuide,
      this.reportProgramGuideUnavailable,
    )
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
    if (this.destroyed || this.applicationExited) return
    if (this.activeRuntimeId) {
      this.postToRuntime('stream-event', { value })
      return
    }
    // Signalling can arrive before the application bootstrap is installed.
    // Retain a small receiver-owned backlog rather than dropping those events.
    if (this.pendingStreamEvents.length === 64) this.pendingStreamEvents.shift()
    this.pendingStreamEvents.push(value)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.pendingStreamEvents.length = 0
    this.ownerWindow.removeEventListener('message', this.handleRuntimeMessage)
    this.iframe.removeEventListener('load', this.handleFrameLoad)
    this.resizeObserver.disconnect()
    this.clearApplicationLoadTimer()
    this.invalidateRuntime('host-destroy')
    this.video = null
  }

  private readonly handleFrameLoad = (): void => {
    if (this.applicationExited) return
    // Navigation keeps the iframe element, but a same-origin application may
    // have touched frameElement while its previous document was active.
    // Reassert the display-only input contract before accepting the new page.
    makeIframePointerTransparent(this.iframe)
    try {
      const location = this.iframe.contentWindow?.location
      if (!location || location.href === 'about:blank') return
      if (location?.origin === this.origin) {
        const loadedUrl = location.href
        // The injected bootstrap runs while the document is parsed. Let its
        // queued postMessage run first, then reject a loaded 404/error document
        // immediately instead of leaving it visible until the watchdog fires.
        this.ownerWindow.setTimeout(() => {
          if (this.destroyed || this.applicationExited || this.activeRuntimeId) return
          try {
            if (this.iframe.contentWindow?.location.href !== loadedUrl) return
          } catch {
            return
          }
          this.failApplicationLoad(loadedUrl)
        }, 0)
        return
      }
    } catch {
      // A cross-origin page cannot participate in this receiver session.
    }
    this.clearApplicationLoadTimer()
    this.invalidateRuntime('document-unload')
    this.onStatus?.('通信ページをブロックしました')
    this.onLifecycle?.({ type: 'frame-blocked', url: this.iframe.src })
    this.exitApplication('通信ページをブロックしました')
  }

  private readonly reportProgramGuideUnavailable = (
    event: AribProgramGuideUnavailableEvent,
  ): void => {
    const message = event.request.destination === 'program-detail'
      ? 'このプレーヤーでは放送予定の番組詳細を表示できません。'
      : 'このプレーヤーでは番組表を表示できません。'
    this.onStatus?.(message)
    if (this.onProgramGuideUnavailable) {
      this.onProgramGuideUnavailable(event)
      return
    }
    this.ownerWindow.alert?.(message)
  }

  private readonly handleRuntimeMessage = (event: MessageEvent): void => {
    if (event.origin !== this.origin) return
    const message = event.data as RuntimeMessage
    if (message?.type !== 'arib-runtime' || typeof message.runtimeId !== 'string') return

    if (message.event === 'installed') {
      this.clearApplicationLoadTimer()
      this.activeRuntimeId = message.runtimeId
      this.onUrlChange?.(String(message.url ?? ''))
      this.postToRuntime('caption-tracks', { componentTags: this.captionComponentTags })
      if (this.programInfo) this.postToRuntime('program-info', { value: this.programInfo })
      for (const value of this.pendingStreamEvents.splice(0)) {
        this.postToRuntime('stream-event', { value })
      }
      this.onStatus?.('ランタイム導入済み')
      this.onLifecycle?.({
        type: 'installed',
        url: String(message.url ?? ''),
        runtimeId: message.runtimeId,
      })
      return
    }
    if (message.runtimeId !== this.activeRuntimeId) return

    switch (message.event) {
      case 'unloading':
        this.invalidateRuntime('document-unload')
        this.onStatus?.('ページ遷移中')
        this.onLifecycle?.({ type: 'navigating', url: String(message.url ?? '') })
        this.armApplicationLoadTimer(String(message.url ?? this.iframe.src))
        return
      case 'navigation-blocked':
        this.onStatus?.('外部URLをブロックしました')
        this.onUrlChange?.(String(message.url ?? ''))
        this.onLifecycle?.({
          type: 'navigation-blocked',
          url: String(message.url ?? ''),
        })
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
      case 'caption-subscription': {
        const componentTags = Array.isArray(message.componentTags)
          ? [...new Set(message.componentTags
              .map(Number)
              .filter(value => Number.isInteger(value) && value >= 0 && value <= 0xffff))]
          : []
        this.onCaptionSubscription?.({ componentTags })
        return
      }
      case 'replace-application': {
        const organizationId = Number(message.organizationId)
        const applicationId = Number(message.applicationId)
        const request: AribApplicationReplaceRequest = {
          organizationId,
          applicationId,
          aitUrl: message.aitUrl === null || message.aitUrl === undefined
            ? null
            : String(message.aitUrl),
        }
        if (!Number.isSafeInteger(organizationId) || organizationId < 0 ||
            !Number.isSafeInteger(applicationId) || applicationId < 0) {
          this.onStatus?.('不正なアプリケーション切替要求を拒否しました')
          return
        }
        if (!this.onReplaceApplication) {
          this.onStatus?.('アプリケーション切替に対応していません')
          return
        }
        void Promise.resolve(this.onReplaceApplication(request)).catch(error => {
          this.onStatus?.(`アプリケーション切替エラー：${String(error)}`)
          this.onLifecycle?.({ type: 'error', message: String(error) })
        })
        return
      }
      case 'exit-managed-state': {
        const url = String(message.url ?? '')
        if (!this.onExitManagedState) {
          this.onStatus?.('管理外アプリケーションへの遷移に対応していません')
          return
        }
        void Promise.resolve(this.onExitManagedState(url)).catch(error => {
          this.onStatus?.(`管理外アプリケーション遷移エラー：${String(error)}`)
          this.onLifecycle?.({ type: 'error', message: String(error) })
        })
        return
      }
      case 'destroy':
        this.exitApplication('アプリケーション終了')
        return
      case 'error':
        this.onStatus?.(`ランタイムエラー：${String(message.message ?? '')}`)
        this.onLifecycle?.({ type: 'error', message: String(message.message ?? '') })
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
      externalPlacement: layer.externalPlacement === 'above-application'
        ? 'above-application'
        : 'behind-application',
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

  private armApplicationLoadTimer(url: string): void {
    this.clearApplicationLoadTimer()
    if (this.applicationLoadTimeoutMs === 0) return
    this.applicationLoadTimer = this.ownerWindow.setTimeout(() => {
      this.applicationLoadTimer = null
      if (this.destroyed || this.applicationExited || this.activeRuntimeId) return
      this.failApplicationLoad(url)
    }, this.applicationLoadTimeoutMs)
  }

  private failApplicationLoad(url: string): void {
    if (this.destroyed || this.applicationExited || this.activeRuntimeId) return
    this.clearApplicationLoadTimer()
    const message = `データ放送ページにランタイムを導入できませんでした: ${url}`
    this.onLifecycle?.({ type: 'error', message })
    this.exitApplication('データ放送ページを読み込めませんでした')
  }

  private clearApplicationLoadTimer(): void {
    if (this.applicationLoadTimer === null) return
    this.ownerWindow.clearTimeout(this.applicationLoadTimer)
    this.applicationLoadTimer = null
  }

  private invalidateRuntime(reason: AribMediaPlaneUnmountReason): void {
    this.activeRuntimeId = null
    this.mediaPlaneEnabled = false
    this.onCaptionSubscription?.({ componentTags: [] })
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
