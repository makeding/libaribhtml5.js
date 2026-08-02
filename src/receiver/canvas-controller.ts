import {
  normalizeLctBackgroundColor,
  resolveReceiverBackgroundColor,
} from '../layout'

type ReceiverCanvasSize = {
  width: number
  height: number
}

type CanvasResizeObserver = Pick<ResizeObserver, 'observe' | 'disconnect'>

type ReceiverCanvasControllerOptions = {
  iframe: HTMLIFrameElement
  viewport: HTMLElement
  createResizeObserver?: (callback: ResizeObserverCallback) => CanvasResizeObserver
}

/** Owns receiver-canvas geometry and background selection for the host facade. */
export class ReceiverCanvasController {
  private readonly iframe: HTMLIFrameElement
  private readonly viewport: HTMLElement
  private readonly resizeObserver: CanvasResizeObserver

  private logicalWidth = 3840
  private logicalHeight = 2160
  private lctBackgroundColor: string | null = null
  private stageBackgroundColor: string | null = null

  constructor(options: ReceiverCanvasControllerOptions) {
    this.iframe = options.iframe
    this.viewport = options.viewport
    const createResizeObserver = options.createResizeObserver ??
      ((callback: ResizeObserverCallback) => new ResizeObserver(callback))
    this.resizeObserver = createResizeObserver(() => this.fit())
    this.resizeObserver.observe(this.viewport)
    this.fit()
  }

  get logicalSize(): ReceiverCanvasSize {
    return { width: this.logicalWidth, height: this.logicalHeight }
  }

  setLctBackgroundColor(backgroundColorRgb: number | null): void {
    this.lctBackgroundColor = normalizeLctBackgroundColor(backgroundColorRgb)
    this.applyBackgroundColor()
  }

  setStageBackgroundColor(backgroundColor: string | null): void {
    this.stageBackgroundColor = backgroundColor
    this.applyBackgroundColor()
  }

  resetStageBackground(): void {
    this.stageBackgroundColor = null
    this.applyBackgroundColor()
  }

  applyScreenSize(width: number, height: number): void {
    this.logicalWidth = width
    this.logicalHeight = height
    this.viewport.style.aspectRatio = `${width} / ${height}`
    this.fit()
  }

  fit(): void {
    const scale = Math.min(
      this.viewport.clientWidth / this.logicalWidth,
      this.viewport.clientHeight / this.logicalHeight,
    )
    this.iframe.style.width = `${this.logicalWidth}px`
    this.iframe.style.height = `${this.logicalHeight}px`
    this.iframe.style.transform = `scale(${scale})`
  }

  dispose(): void {
    this.resizeObserver.disconnect()
  }

  private applyBackgroundColor(): void {
    this.viewport.style.backgroundColor = resolveReceiverBackgroundColor(
      this.lctBackgroundColor,
      this.stageBackgroundColor,
    )
  }
}
