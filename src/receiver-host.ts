import {
  installRuntime,
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
import {
  ViewerParticipationController,
  type AribApplicationPresentationState,
  type AribViewerParticipationEvent,
  type AribViewerParticipationNotification,
} from './viewer-participation'
import {
  normalizeApplicationReplaceRequest,
  normalizeCaptionSubscriptionTags,
  normalizeMediaPlane,
  normalizeStageBackgroundColor,
  type RuntimeMessage,
} from './receiver/protocol'
import { ReceiverCanvasController } from './receiver/canvas-controller'
import { RuntimeSessionController } from './receiver/runtime-session-controller'
import type {
  AribApplicationInformation,
  AribApplicationReplaceHandler,
  AribBroadcastClock,
  AribCaptionPacket,
  AribCaptionSubscription,
  AribExitManagedStateHandler,
  AribReceiverHostOptions,
  AribReceiverLifecycleEvent,
} from './receiver/types'

export type {
  AribMediaPlane,
  AribMediaPlaneAdapter,
  AribMediaPlaneLayer,
  AribMediaPlaneStackEntry,
  AribMediaPlaneUnmountReason,
  AribVideoPlane,
} from './media-plane'

export type {
  AribApplicationInformation,
  AribApplicationReplaceHandler,
  AribApplicationReplaceRequest,
  AribBroadcastClock,
  AribCaptionPacket,
  AribCaptionSubscription,
  AribExitManagedStateHandler,
  AribReceiverHostOptions,
  AribReceiverLifecycleEvent,
} from './receiver/types'

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
  private readonly onViewerParticipation?: (event: AribViewerParticipationEvent) => void
  private readonly viewerParticipation = new ViewerParticipationController()
  private readonly canvas: ReceiverCanvasController
  private readonly runtimeSession: RuntimeSessionController
  private captionComponentTags: number[] = []
  private applicationInformation: AribApplicationInformation = {}
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
    this.onViewerParticipation = options.onViewerParticipation

    this.ownerWindow.addEventListener('message', this.handleRuntimeMessage)
    this.iframe.addEventListener('load', this.handleFrameLoad)
    this.canvas = new ReceiverCanvasController({
      iframe: this.iframe,
      viewport: this.viewport,
    })
    this.runtimeSession = new RuntimeSessionController({
      ownerWindow: this.ownerWindow,
      iframe: this.iframe,
      origin: this.origin,
      applicationLoadTimeoutMs: this.applicationLoadTimeoutMs,
      onApplicationLoadTimeout: url => this.failApplicationLoad(url),
    })
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
    this.applicationInformation = application ? {
      ...application,
      permissionManagedAreas: application.permissionManagedAreas?.map(area => ({
        permissionBitmaps: area.permissionBitmaps === null
          ? null
          : [...area.permissionBitmaps],
        managedUrls: area.managedUrls === null ? null : [...area.managedUrls],
      })),
    } : {}
    this.runtimeSession.postToRuntime('application-information', {
      value: this.applicationInformation,
    })
  }

  /**
   * Set the receiver-owned background plane from the current LCT
   * Background_Color_Descriptor. Pass null when changing service/session or
   * when the active LCT no longer carries the descriptor.
   */
  setLctBackgroundColor(backgroundColorRgb: number | null): void {
    this.assertAlive()
    this.canvas.setLctBackgroundColor(backgroundColorRgb)
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
    this.viewerParticipation.resetPresentation()
    this.iframe.style.removeProperty('display')
    this.invalidateRuntime('document-unload')
    // The receiver-owned background plane remains below an external video
    // surface. It must not be moved into the iframe, where it would cover the
    // video together with the application canvas.
    this.canvas.resetStageBackground()
    this.onStatus?.(status)
    this.onUrlChange?.(resolved.pathname)
    this.onLifecycle?.({ type: 'loading', url: resolved.href })
    resolved.searchParams.set('runtime', Date.now().toString())
    this.iframe.src = resolved.href
    this.runtimeSession.armWatchdog(resolved.href)
  }

  /** Leave data-broadcast mode and restore media to the ordinary player. */
  exitApplication(status = 'データ放送終了'): void {
    this.assertAlive()
    if (this.applicationExited) return
    this.applicationExited = true
    this.viewerParticipation.setPresentation({ visible: false, inputActive: false })
    this.runtimeSession.clearPendingStreamEvents()
    this.runtimeSession.clearWatchdog()
    this.invalidateRuntime('application-exit')
    this.iframe.style.display = 'none'
    this.iframe.src = 'about:blank'
    this.onUrlChange?.('')
    this.onStatus?.(status)
    this.onLifecycle?.({ type: 'exited' })
  }

  dispatchKey(code: number): boolean {
    this.assertAlive()
    if (!this.viewerParticipation.presentation.inputActive) return false
    const target = this.iframe.contentWindow
    if (!target) return false
    try {
      for (const type of ['keydown', 'keyup']) {
        const event = new KeyboardEvent(type, { bubbles: true, cancelable: true })
        Object.defineProperties(event, {
          keyCode: { value: code },
          which: { value: code },
        })
        target.document.dispatchEvent(event)
      }
      return true
    } catch {
      this.onStatus?.('キー入力を送信できません')
      return false
    }
  }

  /** Transfer or release receiver-key ownership for the broadcast application. */
  setApplicationInputActive(active: boolean): void {
    this.assertAlive()
    this.viewerParticipation.setPresentation({ inputActive: Boolean(active) })
    this.runtimeSession.postToRuntime('receiver-input-state', { active: Boolean(active) })
  }

  getApplicationPresentationState(): AribApplicationPresentationState {
    return this.viewerParticipation.presentation
  }

  /** Handle the descriptor-less TR-B39 receiver notification outside the application. */
  notifyViewerParticipationCorner(notification: AribViewerParticipationNotification): void {
    if (this.destroyed) return
    const event = this.viewerParticipation.notify(notification)
    if (event) this.onViewerParticipation?.(event)
  }

  /** Discard notification versions while changing service or playback session. */
  resetViewerParticipationNotifications(): void {
    this.assertAlive()
    this.viewerParticipation.resetSession()
    this.runtimeSession.postToRuntime('receiver-input-state', { active: false })
  }

  setCaptionTracks(componentTags: number[]): void {
    this.captionComponentTags = [...new Set(componentTags.filter(Number.isInteger))]
    this.runtimeSession.postToRuntime('caption-tracks', {
      componentTags: this.captionComponentTags,
    })
  }

  pushCaption(packet: AribCaptionPacket): void {
    this.runtimeSession.postToRuntime('caption-data', packet)
  }

  resetCaptions(): void {
    this.captionComponentTags = []
    this.runtimeSession.postToRuntime('caption-reset')
  }

  /** Notify a stored carousel resource after the receiver updates or removes it. */
  notifyDataResource(path: string, change: BroadcastResourceChange): void {
    this.runtimeSession.postToRuntime('resource-change', { path, change })
  }

  setProgramInfo(value: ProgramInfo): void {
    this.programInfo = cloneProgramInfo(value)
    this.runtimeSession.postToRuntime('program-info', { value: this.programInfo })
  }

  /** Clear stale EIT state while changing services or broadcast sessions. */
  clearProgramInfo(): void {
    this.programInfo = null
    this.runtimeSession.postToRuntime('program-info', { value: null })
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
    this.runtimeSession.emitStreamEvent(value)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.runtimeSession.clearPendingStreamEvents()
    this.ownerWindow.removeEventListener('message', this.handleRuntimeMessage)
    this.iframe.removeEventListener('load', this.handleFrameLoad)
    this.canvas.dispose()
    this.runtimeSession.dispose()
    this.disableRuntime('host-destroy')
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
          if (this.destroyed || this.applicationExited ||
              this.runtimeSession.hasActiveRuntime) return
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
    this.runtimeSession.clearWatchdog()
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
      this.runtimeSession.acceptInstalled(message.runtimeId, {
        captionComponentTags: this.captionComponentTags,
        applicationInformation: this.applicationInformation,
        inputActive: this.viewerParticipation.presentation.inputActive,
        programInfo: this.programInfo,
      }, () => this.onUrlChange?.(String(message.url ?? '')))
      this.onStatus?.('ランタイム導入済み')
      this.onLifecycle?.({
        type: 'installed',
        url: String(message.url ?? ''),
        runtimeId: message.runtimeId,
      })
      return
    }
    if (!this.runtimeSession.matches(message.runtimeId)) return

    switch (message.event) {
      case 'unloading':
        this.invalidateRuntime('document-unload')
        this.onStatus?.('ページ遷移中')
        this.onLifecycle?.({ type: 'navigating', url: String(message.url ?? '') })
        this.runtimeSession.armWatchdog(String(message.url ?? this.iframe.src))
        return
      case 'navigation-blocked':
        this.onStatus?.('外部URLをブロックしました')
        this.onUrlChange?.(String(message.url ?? ''))
        this.onLifecycle?.({
          type: 'navigation-blocked',
          url: String(message.url ?? ''),
        })
        return
      case 'application-boundary-exit':
        this.exitApplication('アプリケーション境界外への遷移を終了しました')
        return
      case 'stage-style': {
        this.canvas.setStageBackgroundColor(
          normalizeStageBackgroundColor(message.backgroundColor),
        )
        return
      }
      case 'media-plane':
      case 'video-plane':
        this.applyMediaPlane(message)
        return
      case 'caption-subscription': {
        const componentTags = normalizeCaptionSubscriptionTags(message.componentTags)
        this.onCaptionSubscription?.({ componentTags })
        return
      }
      case 'application-presentation':
        this.viewerParticipation.setPresentation({
          visible: Boolean(message.visible),
          inputActive: Boolean(message.inputActive),
        })
        return
      case 'replace-application': {
        const request = normalizeApplicationReplaceRequest(message)
        if (!request) {
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
    const logicalSize = this.canvas.logicalSize
    const plane = normalizeMediaPlane(message, {
      screenWidth: logicalSize.width,
      screenHeight: logicalSize.height,
    })
    if (!plane.visible) {
      this.onMediaPlane?.(plane)
      this.onVideoPlane?.(plane)
      return
    }
    this.canvas.applyScreenSize(plane.screenWidth, plane.screenHeight)
    this.onStatus?.(`映像 ${Math.round(plane.width)}×${Math.round(plane.height)}` +
      ` / 位置 ${Math.round(plane.x)},${Math.round(plane.y)}`)
    this.onMediaPlane?.(plane)
    this.onVideoPlane?.(plane)
  }

  private failApplicationLoad(url: string): void {
    if (this.destroyed || this.applicationExited || this.runtimeSession.hasActiveRuntime) return
    this.runtimeSession.clearWatchdog()
    const message = `データ放送ページにランタイムを導入できませんでした: ${url}`
    this.onLifecycle?.({ type: 'error', message })
    this.exitApplication('データ放送ページを読み込めませんでした')
  }

  private invalidateRuntime(reason: AribMediaPlaneUnmountReason): void {
    this.runtimeSession.invalidate()
    this.disableRuntime(reason)
  }

  private disableRuntime(reason: AribMediaPlaneUnmountReason): void {
    this.mediaPlaneEnabled = false
    this.onCaptionSubscription?.({ componentTags: [] })
    this.mediaPlaneAdapter?.unmountMediaPlane(reason)
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error('AribReceiverHost has been destroyed')
  }
}
