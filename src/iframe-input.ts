type PointerTransparentIframe = Pick<HTMLIFrameElement, 'style' | 'tabIndex'>

/** Keep the application plane visible while passing pointer input to the player below it. */
export function makeIframePointerTransparent(iframe: PointerTransparentIframe): void {
  iframe.style.pointerEvents = 'none'
  iframe.tabIndex = -1
}
