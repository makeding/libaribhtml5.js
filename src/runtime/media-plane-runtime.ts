import type {
  AribMediaPlane,
  AribMediaPlaneAdapter,
  AribMediaPlaneUnmountReason,
} from '../media-plane'
import { ExternalMediaHoleController } from './external-media-hole'
import { resolveBroadcastMediaSlot } from './media-slot'

type RuntimeWindow = Window & typeof globalThis

type RuntimeMediaPlaneControllerOptions = {
  target: RuntimeWindow
  adapter?: AribMediaPlaneAdapter
  canUseBroadcastMedia: () => boolean
  installBroadcastObjectApi: (object: HTMLElement) => void
  postRuntime: (event: string, detail?: Record<string, unknown>) => void
}

const mediaObjectSelector =
  'object[type="video/x-arib2-broadcast"], ' +
  'object[data-arib-type="video/x-arib2-broadcast"]'

const mediaAnimationEvents = [
  'animationstart',
  'animationend',
  'animationcancel',
  'transitionrun',
  'transitionend',
  'transitioncancel',
] as const

/** Owns the document-side media-plane observation and compositor lifecycle. */
export class RuntimeMediaPlaneController {
  private readonly target: RuntimeWindow
  private readonly adapter?: AribMediaPlaneAdapter
  private readonly canUseBroadcastMedia: () => boolean
  private readonly installBroadcastObjectApi: (object: HTMLElement) => void
  private readonly postRuntime: (
    event: string,
    detail?: Record<string, unknown>,
  ) => void

  private readonly mediaObjectIds = new WeakMap<HTMLElement, string>()
  private readonly externalMediaHole: ExternalMediaHoleController
  private readonly resizeObserver: ResizeObserver | null
  private mutationObserver: MutationObserver | null = null

  private nextMediaObjectId = 1
  private activeMediaObject: HTMLElement | null = null
  private lastMediaPlane = ''
  private stageStyleReported = false
  private observedMediaObject: HTMLElement | null = null
  private mediaPlaneFrame: number | null = null
  private observing = false
  private disposed = false

  constructor(options: RuntimeMediaPlaneControllerOptions) {
    this.target = options.target
    this.adapter = options.adapter
    this.canUseBroadcastMedia = options.canUseBroadcastMedia
    this.installBroadcastObjectApi = options.installBroadcastObjectApi
    this.postRuntime = options.postRuntime
    this.externalMediaHole = new ExternalMediaHoleController(this.target)
    this.resizeObserver = typeof this.target.ResizeObserver === 'function'
      ? new this.target.ResizeObserver(this.schedule)
      : null
  }

  /** Install APIs needed by static objects, prepare the canvas, and queue a report. */
  startDocument(): void {
    const object = this.findMediaObject()
    if (object) this.installBroadcastObjectApi(object)
    this.prepareExternalMediaPlaneCanvas()
    this.schedule()
  }

  /** Start document observers after the runtime's installed handshake was sent. */
  startObserving(): void {
    if (this.observing || this.disposed) return
    this.observing = true
    this.mutationObserver = new this.target.MutationObserver(this.schedule)
    this.mutationObserver.observe(this.target.document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'type', 'data-arib-type', 'name', 'value'],
      childList: true,
      subtree: true,
    })
    this.resizeObserver?.observe(this.target.document.documentElement)
    this.target.addEventListener('resize', this.schedule)
    for (const event of mediaAnimationEvents) {
      this.target.document.addEventListener(event, this.schedule, true)
    }
    // Synchronize even when the document was already parsed and no mutation follows.
    queueMicrotask(this.schedule)
  }

  readonly schedule = (): void => {
    if (this.disposed || this.mediaPlaneFrame !== null) return
    this.mediaPlaneFrame = this.target.requestAnimationFrame(() => {
      this.mediaPlaneFrame = null
      this.reportMediaPlane()
      if (this.activeMediaAnimation()) this.schedule()
    })
  }

  /**
   * Stop observation, run document-owned cleanup, then restore and unmount the
   * media plane. The cleanup hook preserves the original pagehide ordering.
   */
  dispose(
    reason: Extract<AribMediaPlaneUnmountReason, 'document-unload'>,
    beforeUnmount?: () => void,
  ): void {
    if (this.disposed) return
    this.disposed = true
    if (this.mediaPlaneFrame !== null) this.target.cancelAnimationFrame(this.mediaPlaneFrame)
    this.mediaPlaneFrame = null
    this.mutationObserver?.disconnect()
    this.resizeObserver?.disconnect()
    this.target.removeEventListener('resize', this.schedule)
    beforeUnmount?.()
    this.unmountMediaPlane(reason)
  }

  private findMediaObject(): HTMLElement | null {
    return this.canUseBroadcastMedia()
      ? this.target.document.querySelector<HTMLElement>(mediaObjectSelector)
      : null
  }

  private reportStageStyle(): void {
    const body = this.target.document.body
    const style = this.target.getComputedStyle(body ?? this.target.document.documentElement)
    let backgroundColor = style.backgroundColor
    const canvasRect = body?.getBoundingClientRect()
    if (canvasRect && canvasRect.width > 0 && canvasRect.height > 0) {
      const tolerance = 1
      for (const element of this.target.document.querySelectorAll<HTMLElement>('body *')) {
        const candidateStyle = this.target.getComputedStyle(element)
        if (candidateStyle.backgroundColor === 'rgba(0, 0, 0, 0)' ||
            candidateStyle.backgroundColor === 'transparent') continue
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0 ||
            rect.left > canvasRect.left + tolerance ||
            rect.top > canvasRect.top + tolerance ||
            rect.right < canvasRect.right - tolerance ||
            rect.bottom < canvasRect.bottom - tolerance) continue
        // Caption applications commonly put the real black stage in a
        // full-canvas #backscreen while leaving body white.
        backgroundColor = candidateStyle.backgroundColor
        break
      }
    }
    this.postRuntime('stage-style', { backgroundColor })
  }

  private prepareExternalMediaPlaneCanvas(): void {
    if (this.adapter?.renderMode !== 'external') return
    // Pin the child canvas to the receiver's light colour scheme. Otherwise
    // Chromium may paint an opaque iframe canvas inherited from a dark host.
    this.target.document.documentElement.style.setProperty(
      'color-scheme',
      'only light',
      'important',
    )
    this.target.document.documentElement.style.setProperty(
      'background',
      'transparent',
      'important',
    )
    if (this.target.document.body) {
      this.target.document.body.style.setProperty('background', 'transparent', 'important')
    }
  }

  private activeMediaAnimation(): boolean {
    const mediaObject = this.activeMediaObject
    if (!mediaObject || typeof this.target.document.getAnimations !== 'function') return false
    return this.target.document.getAnimations().some(animation => {
      if (animation.playState !== 'running') return false
      const animated = (animation.effect as KeyframeEffect | null)?.target
      return animated instanceof this.target.Element && (
        animated === mediaObject ||
        animated.contains(mediaObject) ||
        mediaObject.contains(animated)
      )
    })
  }

  private observeMediaObject(object: HTMLElement | null): void {
    if (object === this.observedMediaObject) return
    if (this.observedMediaObject) this.resizeObserver?.unobserve(this.observedMediaObject)
    this.observedMediaObject = object
    if (object) this.resizeObserver?.observe(object)
  }

  private logicalViewport(): { width: number; height: number } {
    const content = this.target.document
      .querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content ?? ''
    const width = Number(content.match(/(?:^|,)\s*width\s*=\s*(\d+)/i)?.[1] ?? 3840)
    const height = Number(content.match(/(?:^|,)\s*height\s*=\s*(\d+)/i)?.[1] ?? 2160)
    return { width, height }
  }

  private slotIdFor(object: HTMLElement): string {
    const existing = this.mediaObjectIds.get(object)
    if (existing) return existing
    const slotId = `media-plane-${this.nextMediaObjectId++}`
    this.mediaObjectIds.set(object, slotId)
    return slotId
  }

  private callMediaPlaneAdapter(callback: () => void): void {
    try {
      callback()
    } catch (error) {
      this.postRuntime('error', {
        message: `Media-plane adapter failed: ${String(error)}`,
      })
    }
  }

  private unmountMediaPlane(
    reason: Extract<AribMediaPlaneUnmountReason, 'slot-removed' | 'document-unload'>,
  ): void {
    if (this.activeMediaObject) this.externalMediaHole.set(this.activeMediaObject, false)
    else this.externalMediaHole.restore()
    if (this.adapter) {
      this.callMediaPlaneAdapter(() => this.adapter?.unmountMediaPlane(reason))
    }
    this.activeMediaObject = null
  }

  private reportMediaPlane(): void {
    // Sample after document ready but before clearing application backgrounds.
    if (!this.stageStyleReported && this.target.document.readyState !== 'loading') {
      this.reportStageStyle()
      this.stageStyleReported = true
    }
    const object = this.findMediaObject()
    if (!object) {
      this.observeMediaObject(null)
      const removedSlotId = this.activeMediaObject
        ? this.slotIdFor(this.activeMediaObject)
        : ''
      if (this.activeMediaObject) this.unmountMediaPlane('slot-removed')
      const screen = this.logicalViewport()
      const plane: AribMediaPlane = {
        slotId: removedSlotId,
        visible: false,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        screenWidth: screen.width,
        screenHeight: screen.height,
        layer: { documentOrder: -1, stackingPath: [] },
      }
      const message = JSON.stringify(plane)
      if (message !== this.lastMediaPlane) {
        this.lastMediaPlane = message
        this.postRuntime('media-plane', plane)
      }
      return
    }

    this.observeMediaObject(object)
    this.installBroadcastObjectApi(object)
    const slot = resolveBroadcastMediaSlot(object)
    const rect = slot.rect
    const style = this.target.getComputedStyle(object)
    const videoSource = object.querySelector<HTMLParamElement>('param[name="video_src"]')?.value
    const audioSource = object.querySelector<HTMLParamElement>('param[name="audio_src"]')?.value
    const screen = this.logicalViewport()
    const stackingPath = this.externalMediaHole.describeStackingPath(object)
    const plane: AribMediaPlane = {
      slotId: this.slotIdFor(object),
      visible: style.display !== 'none' && style.visibility !== 'hidden' &&
        rect.width > 0 && rect.height > 0 &&
        stackingPath.every((entry) => entry.display !== 'none' &&
          entry.visibility !== 'hidden' && entry.opacity > 0),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      screenWidth: screen.width,
      screenHeight: screen.height,
      videoSource,
      audioSource,
      layer: {
        documentOrder: Array.from(this.target.document.querySelectorAll('*')).indexOf(object),
        stackingPath,
        externalPlacement: slot.element !== object &&
          Number.parseInt(this.target.getComputedStyle(slot.element).zIndex, 10) > 0
          ? 'above-application'
          : 'behind-application',
      },
    }
    const message = JSON.stringify(plane)
    if (object !== this.activeMediaObject) {
      if (this.activeMediaObject) this.unmountMediaPlane('slot-removed')
      this.activeMediaObject = object
      if (this.adapter) {
        this.callMediaPlaneAdapter(() => this.adapter?.mountMediaPlane(object, plane))
      }
    } else if (message !== this.lastMediaPlane && this.adapter) {
      this.callMediaPlaneAdapter(() => this.adapter?.updateMediaPlane(object, plane))
    }
    this.externalMediaHole.set(
      object,
      (this.adapter?.renderMode ?? 'external') === 'external',
    )
    if (message === this.lastMediaPlane) return
    this.lastMediaPlane = message
    this.postRuntime('media-plane', plane)
  }
}
