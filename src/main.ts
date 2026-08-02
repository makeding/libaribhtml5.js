import './style.css'
import { AribReceiverHost } from './receiver-host'
import { DomObjectMediaPlaneAdapter } from './media-plane'
import type { RuntimeWindow } from './runtime/install'

declare global {
  interface Window {
    __ARIB_HTML5_INSTALL__?: (target: RuntimeWindow) => void
    aribReceiverHost?: AribReceiverHost
  }
}

const iframe = document.querySelector<HTMLIFrameElement>('#broadcast')!
const viewport = document.querySelector<HTMLElement>('#viewport')!
const videoSurface = document.querySelector<HTMLElement>('.video-surface')!
const video = document.querySelector<HTMLVideoElement>('#broadcast-video')!
const status = document.querySelector<HTMLElement>('#status')!
const urlLabel = document.querySelector<HTMLElement>('#url')!

if (!iframe || !viewport || !videoSurface || !video || !status || !urlLabel) {
  throw new Error('demo shell is incomplete')
}

const host = new AribReceiverHost({
  iframe,
  viewport,
  videoSurface,
  mediaPlaneAdapter: new DomObjectMediaPlaneAdapter({
    media: video,
    normalPlayerContainer: videoSurface,
  }),
  onStatus: (value) => { status.textContent = value },
  onUrlChange: (value) => { urlLabel.textContent = value },
})
host.setProgramInfo({
  original_network_id: 4,
  transport_stream_id: 11,
  service_id: 101,
  event_id: 1,
  event_name: 'BS4Kデモ',
})

window.__ARIB_HTML5_INSTALL__ = (target) => host.installRuntime(target)
window.aribReceiverHost = host

const pages = {
  // Receiver paths are intentionally kept in their broadcast form here. The
  // host maps them below /data-broadcast/ before assigning iframe.src.
  startup: '/sh4/40/001/startup/html/index.html',
  top: '/sh4/60/001/top/source/index4k.html',
} as const

function openPage(page: keyof typeof pages): void {
  host.loadApplication(
    pages[page],
    page === 'startup' ? '透明アプリケーション' : '表示ページ',
  )
}

document.querySelectorAll<HTMLButtonElement>('[data-page]').forEach((button) => {
  button.addEventListener('click', () => openPage(button.dataset.page as keyof typeof pages))
})
document.querySelector<HTMLButtonElement>('[data-action="exit"]')?.addEventListener('click', () => {
  host.exitApplication()
})
document.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((button) => {
  button.addEventListener('click', () => {
    host.setApplicationInputActive(true)
    host.dispatchKey(Number(button.dataset.key))
  })
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
  host.setApplicationInputActive(true)
  host.dispatchKey(code)
})

openPage('startup')
