type TvReceiverIframe = Pick<
  HTMLIFrameElement,
  'contentWindow' | 'inert' | 'style' | 'tabIndex'
>

/** Keep pointer input on the native TV shell without making the child document inert. */
export function configureTvReceiverIframe(iframe: TvReceiverIframe): void {
  iframe.inert = false
  iframe.style.setProperty('pointer-events', 'none', 'important')
  iframe.tabIndex = -1
}

/** Dispatch a receiver key in the child browsing context that owns the application DOM. */
export function dispatchTvReceiverKey(iframe: TvReceiverIframe, code: number): boolean {
  const target = iframe.contentWindow
  if (!target || !Number.isInteger(code)) return false
  try {
    const eventWindow = target as Window & typeof globalThis
    const document = target.document
    const eventTarget = document.activeElement ?? document.body ?? document.documentElement ?? document
    for (const type of ['keydown', 'keyup']) {
      const event = new eventWindow.KeyboardEvent(type, {
        bubbles: true,
        cancelable: true,
        view: target,
      })
      Object.defineProperties(event, {
        keyCode: { value: code },
        which: { value: code },
      })
      eventTarget.dispatchEvent(event)
    }
    return true
  } catch {
    return false
  }
}
