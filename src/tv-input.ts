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

const keyBridges = new WeakMap<Document, string>()

/** Queue a receiver key in the child browsing context that owns the application DOM. */
export function dispatchReceiverKey(iframe: TvReceiverIframe, code: number): boolean {
  const target = iframe.contentWindow
  if (!target || !Number.isInteger(code)) return false
  try {
    const document = target.document
    let token = keyBridges.get(document)
    if (token === undefined) {
      token = crypto.randomUUID()
      const script = document.createElement('script')
      // A child-realm listener and a fresh message task make this document the
      // incumbent document. Direct parent dispatch makes Safari resolve a
      // broadcaster's relative location assignment against the host page.
      script.textContent = `(() => {
        const token = ${JSON.stringify(token)};
        window.addEventListener('message', event => {
          if (event.source !== parent || event.origin !== location.origin ||
              event.data?.type !== 'arib-receiver-key' || event.data.token !== token ||
              !Number.isInteger(event.data.code)) return;
          const eventTarget = document.activeElement ?? document.body ?? document.documentElement ?? document;
          for (const type of ['keydown', 'keyup']) {
            const key = new KeyboardEvent(type, {bubbles: true, cancelable: true, view: window});
            Object.defineProperties(key, {
              keyCode: {value: event.data.code}, which: {value: event.data.code}
            });
            eventTarget.dispatchEvent(key);
          }
        });
      })()`
      document.documentElement.appendChild(script)
      script.remove()
      keyBridges.set(document, token)
    }
    target.postMessage({ type: 'arib-receiver-key', token, code }, target.location.origin)
    return true
  } catch {
    return false
  }
}

/** @deprecated Use dispatchReceiverKey(). */
export const dispatchTvReceiverKey = dispatchReceiverKey
