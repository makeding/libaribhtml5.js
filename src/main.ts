import './style.css'
import { installRuntime } from './runtime/install'

declare global {
  interface Window {
    __ARIB_HTML5_INSTALL__?: (target: Window & typeof globalThis & Record<string, unknown>) => void
  }
}

const iframe = document.querySelector<HTMLIFrameElement>('#broadcast')!
const viewport = document.querySelector<HTMLElement>('#viewport')!
const videoSurface = document.querySelector<HTMLElement>('.video-surface')!
const status = document.querySelector<HTMLElement>('#status')!
const urlLabel = document.querySelector<HTMLElement>('#url')!

if (!iframe || !viewport || !videoSurface || !status || !urlLabel) {
  throw new Error('demo shell is incomplete')
}

window.__ARIB_HTML5_INSTALL__ = installRuntime
let logicalWidth = 3840
let logicalHeight = 2160

const pages = {
  startup: '/sh4/40/001/startup/html/index.html',
  top: '/sh4/60/001/top/source/index4k.html',
} as const

function openPage(page: keyof typeof pages): void {
  const url = pages[page]
  status.textContent = page === 'startup' ? '透明アプリケーション' : '表示ページ'
  urlLabel.textContent = url
  // ARIB HTML5's normal document canvas is opaque white unless the page
  // reports another color. A transparent autostart page is still covered by
  // its full-screen video plane.
  viewport.style.backgroundColor = '#fff'
  Object.assign(videoSurface.style, {
    display: 'none',
    left: '0%',
    top: '0%',
    width: '100%',
    height: '100%',
  })
  iframe.src = `${url}?runtime=${Date.now()}`
}

function dispatchKey(code: number): void {
  const target = iframe.contentWindow
  if (!target) return
  for (const type of ['keydown', 'keyup']) {
    const event = new KeyboardEvent(type, { bubbles: true, cancelable: true })
    Object.defineProperties(event, {
      keyCode: { value: code },
      which: { value: code },
    })
    target.document.dispatchEvent(event)
  }
}

function fitBroadcastCanvas(): void {
  const scale = Math.min(
    viewport.clientWidth / logicalWidth,
    viewport.clientHeight / logicalHeight,
  )
  iframe.style.width = `${logicalWidth}px`
  iframe.style.height = `${logicalHeight}px`
  iframe.style.transform = `scale(${scale})`
}

new ResizeObserver(fitBroadcastCanvas).observe(viewport)
fitBroadcastCanvas()

document.querySelectorAll<HTMLButtonElement>('[data-page]').forEach((button) => {
  button.addEventListener('click', () => openPage(button.dataset.page as keyof typeof pages))
})
document.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((button) => {
  button.addEventListener('click', () => dispatchKey(Number(button.dataset.key)))
})

window.addEventListener('keydown', (event) => {
  const mapping: Record<string, number> = {
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Enter: 13,
    Backspace: 461,
    d: 457,
    D: 457,
    r: 403,
    R: 403,
    g: 404,
    G: 404,
    y: 405,
    Y: 405,
    b: 406,
    B: 406,
    '0': 48,
    '1': 49,
    '2': 50,
    '3': 51,
    '4': 52,
    '5': 53,
    '6': 54,
    '7': 55,
    '8': 56,
    '9': 57,
  }
  const code = mapping[event.key]
  if (code === undefined) return
  event.preventDefault()
  dispatchKey(code)
})

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return
  if (event.data?.type !== 'arib-runtime') return
  if (event.data.event === 'stage-style') {
    const color = String(event.data.backgroundColor ?? '')
    if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
      viewport.style.backgroundColor = color
    }
    return
  }
  if (event.data.event === 'video-plane') {
    if (!event.data.visible) {
      videoSurface.style.display = 'none'
      return
    }
    logicalWidth = Number(event.data.screenWidth) || 3840
    logicalHeight = Number(event.data.screenHeight) || 2160
    viewport.style.aspectRatio = `${logicalWidth} / ${logicalHeight}`
    fitBroadcastCanvas()
    const percent = (value: number, extent: number) => `${value / extent * 100}%`
    Object.assign(videoSurface.style, {
      display: 'grid',
      left: percent(event.data.x, logicalWidth),
      top: percent(event.data.y, logicalHeight),
      width: percent(event.data.width, logicalWidth),
      height: percent(event.data.height, logicalHeight),
    })
    status.textContent = `映像 ${Math.round(event.data.width)}×${Math.round(event.data.height)}` +
      ` / 位置 ${Math.round(event.data.x)},${Math.round(event.data.y)}`
    return
  }
  const runtimeStatuses: Record<string, string> = {
    installed: 'ランタイム導入済み',
    destroy: 'アプリケーション終了',
  }
  status.textContent = event.data.event === 'error'
    ? `ランタイムエラー：${event.data.message}`
    : runtimeStatuses[event.data.event] ?? `ランタイム：${event.data.event}`
})

openPage('startup')
