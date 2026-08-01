type PointerTransparentIframe = Pick<HTMLIFrameElement, 'inert' | 'style' | 'tabIndex'>

/** Keep the application plane visible without making it an input or focus target. */
export function makeIframePointerTransparent(iframe: PointerTransparentIframe): void {
  // `tabindex=-1` only removes the iframe from sequential focus navigation;
  // focus can still enter its document. `inert` covers the complete child
  // navigable and makes hit testing fall back to the host player container.
  iframe.inert = true
  iframe.style.setProperty('pointer-events', 'none', 'important')
  iframe.tabIndex = -1
}
