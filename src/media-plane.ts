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

export interface AribMediaPlaneAdapter {
  /**
   * `in-object` renders at the actual object position in the application DOM.
   * `external` uses a host/native plane and receives the object's layer metadata.
   */
  readonly renderMode: 'in-object' | 'external'
  mountMediaPlane(object: HTMLElement, plane: AribMediaPlane): void
  updateMediaPlane(object: HTMLElement, plane: AribMediaPlane): void
  unmountMediaPlane(): void
}

export type DomObjectMediaPlaneAdapterOptions = {
  media: HTMLElement
  parkingContainer?: HTMLElement
}

/**
 * Browser demo adapter which adopts the media element into the broadcast
 * object's fallback content. This preserves the application's own DOM order.
 */
export class DomObjectMediaPlaneAdapter implements AribMediaPlaneAdapter {
  readonly renderMode = 'in-object' as const

  private readonly media: HTMLElement
  private readonly parkingContainer?: HTMLElement
  private mountedObject: HTMLElement | null = null

  constructor(options: DomObjectMediaPlaneAdapterOptions) {
    this.media = options.media
    this.parkingContainer = options.parkingContainer
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
    if (this.parkingContainer) this.parkingContainer.style.display = 'none'
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

  unmountMediaPlane(): void {
    this.mountedObject = null
    this.media.style.visibility = 'hidden'
    if (this.parkingContainer) {
      if (this.media.parentElement !== this.parkingContainer) {
        this.parkingContainer.replaceChildren(this.media)
      }
      this.parkingContainer.style.display = 'none'
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

  unmountMediaPlane(): void {
    Object.assign(this.surface.style, {
      display: this.keepVisible ? 'grid' : 'none',
      left: '0%',
      top: '0%',
      width: '100%',
      height: '100%',
    })
  }

  private apply(plane: AribMediaPlane): void {
    if (!plane.visible) {
      this.unmountMediaPlane()
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
