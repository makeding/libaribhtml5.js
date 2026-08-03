export * from './index'

import { AribReceiverHost as BrowserReceiverHost } from './receiver-host'
import type { AribReceiverHostOptions } from './receiver-host'
import {
  configureTvReceiverIframe,
  dispatchTvReceiverKey,
} from './tv-input'

/**
 * Android TV receiver host.
 *
 * The browser SDK keeps the complete iframe inert so mouse/touch input falls
 * through to a player below it. Android TV still needs the child document to
 * participate in focus and receive synthetic remote-control key events, while
 * pointer input remains disabled on the iframe element.
 */
export class AribReceiverHost extends BrowserReceiverHost {
  private tvDestroyed = false

  constructor(options: AribReceiverHostOptions) {
    super(options)
    configureTvReceiverIframe(this.iframe)
    this.iframe.addEventListener('load', this.handleTvFrameLoad)
  }

  override dispatchKey(code: number): boolean {
    if (this.tvDestroyed || !this.getApplicationPresentationState().inputActive) return false
    return dispatchTvReceiverKey(this.iframe, code)
  }

  override destroy(): void {
    if (this.tvDestroyed) return
    this.tvDestroyed = true
    this.iframe.removeEventListener('load', this.handleTvFrameLoad)
    super.destroy()
  }

  private readonly handleTvFrameLoad = (): void => {
    configureTvReceiverIframe(this.iframe)
  }
}
