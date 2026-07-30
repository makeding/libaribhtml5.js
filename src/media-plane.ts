export type AribMediaPlaneStackEntry = {
  tagName: string
  id?: string
  position: string
  zIndex: string
  display: string
  visibility: string
  opacity: number
  transform: string
}

export type AribMediaPlaneLayer = {
  documentOrder: number
  stackingPath: AribMediaPlaneStackEntry[]
}

export type AribMediaPlane = {
  slotId: string
  visible: boolean
  x: number
  y: number
  width: number
  height: number
  screenWidth: number
  screenHeight: number
  videoSource?: string
  audioSource?: string
  layer: AribMediaPlaneLayer
}

/** @deprecated Use AribMediaPlane. */
export type AribVideoPlane = AribMediaPlane

export type AribMediaPlaneUnmountReason =
  | 'slot-removed'
  | 'document-unload'
  | 'application-exit'
  | 'host-destroy'

export interface AribMediaPlaneAdapter {
  /**
   * `in-object` renders at the actual object position in the application DOM.
   * `external` uses a host/native plane and receives the object's layer metadata.
   */
  readonly renderMode: 'in-object' | 'external'
  mountMediaPlane(object: HTMLElement, plane: AribMediaPlane): void
  updateMediaPlane(object: HTMLElement, plane: AribMediaPlane): void
  unmountMediaPlane(reason: AribMediaPlaneUnmountReason): void
}

export type DomObjectMediaPlaneAdapterOptions = {
  media: HTMLElement
  /** Container used by the ordinary player outside data-broadcast mode. */
  normalPlayerContainer?: HTMLElement
  /** @deprecated Use normalPlayerContainer. */
  parkingContainer?: HTMLElement
}

/**
 * Browser demo adapter which adopts the media element into the broadcast
 * object's fallback content. This preserves the application's own DOM order.
 */
export class DomObjectMediaPlaneAdapter implements AribMediaPlaneAdapter {
  readonly renderMode = 'in-object' as const

  private readonly media: HTMLElement
  private readonly normalPlayerContainer?: HTMLElement
  private mountedObject: HTMLElement | null = null

  constructor(options: DomObjectMediaPlaneAdapterOptions) {
    this.media = options.media
    this.normalPlayerContainer = options.normalPlayerContainer ?? options.parkingContainer
    this.media.dataset.aribMediaPlaneContent = ''
    Object.assign(this.media.style, {
      display: 'block',
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      background: '#000',
      pointerEvents: 'none',
    })
  }

  mountMediaPlane(object: HTMLElement, plane: AribMediaPlane): void {
    this.mountedObject = object
    if (this.normalPlayerContainer) this.normalPlayerContainer.style.display = 'none'
    if (this.media.parentElement !== object) object.append(this.media)
    this.media.style.visibility = plane.visible ? 'visible' : 'hidden'
  }

  updateMediaPlane(object: HTMLElement, plane: AribMediaPlane): void {
    if (object !== this.mountedObject || this.media.parentElement !== object) {
      this.mountMediaPlane(object, plane)
      return
    }
    this.media.style.visibility = plane.visible ? 'visible' : 'hidden'
  }

  unmountMediaPlane(reason: AribMediaPlaneUnmountReason): void {
    this.mountedObject = null
    const returnToNormalPlayer = reason === 'application-exit'
    this.media.style.visibility = returnToNormalPlayer ? 'visible' : 'hidden'
    if (this.normalPlayerContainer) {
      if (this.media.parentElement !== this.normalPlayerContainer) {
        this.normalPlayerContainer.replaceChildren(this.media)
      }
      Object.assign(this.normalPlayerContainer.style, {
        display: returnToNormalPlayer ? 'grid' : 'none',
        left: '0%',
        top: '0%',
        width: '100%',
        height: '100%',
      })
    } else {
      this.media.remove()
    }
  }
}

export type BehindIframeMediaPlaneAdapterOptions = {
  surface: HTMLElement
  keepVisible?: boolean
}

/**
 * Simplified compatibility fallback. It cannot interleave media with elements
 * inside the application iframe; the complete iframe is always above it.
 */
export class BehindIframeMediaPlaneAdapter implements AribMediaPlaneAdapter {
  readonly renderMode = 'external' as const

  private readonly surface: HTMLElement
  private readonly keepVisible: boolean

  constructor(options: BehindIframeMediaPlaneAdapterOptions) {
    this.surface = options.surface
    this.keepVisible = options.keepVisible ?? false
  }

  mountMediaPlane(_object: HTMLElement, plane: AribMediaPlane): void {
    this.apply(plane)
  }

  updateMediaPlane(_object: HTMLElement, plane: AribMediaPlane): void {
    this.apply(plane)
  }

  unmountMediaPlane(reason: AribMediaPlaneUnmountReason): void {
    const visible = reason === 'application-exit' || this.keepVisible
    Object.assign(this.surface.style, {
      display: visible ? 'grid' : 'none',
      left: '0%',
      top: '0%',
      width: '100%',
      height: '100%',
    })
  }

  private apply(plane: AribMediaPlane): void {
    if (!plane.visible) {
      this.unmountMediaPlane('slot-removed')
      return
    }
    const percent = (value: number, extent: number) => `${value / extent * 100}%`
    Object.assign(this.surface.style, {
      display: 'grid',
      left: percent(plane.x, plane.screenWidth),
      top: percent(plane.y, plane.screenHeight),
      width: percent(plane.width, plane.screenWidth),
      height: percent(plane.height, plane.screenHeight),
    })
  }
}
