type ExternalNetworkTarget = Window & typeof globalThis

/**
 * Make the receiver's optional external HTTP communication path fail fast while
 * preserving same-origin access to receiver-managed broadcast resources.
 */
export function installExternalNetworkPolicy(
  target: ExternalNetworkTarget,
  allowExternalNetwork: boolean | undefined,
): void {
  if (allowExternalNetwork) return

  const isExternalUrl = (value: unknown): boolean => {
    try {
      const url = new URL(String(value), target.location.href)
      return /^https?:$/.test(url.protocol) && url.origin !== target.location.origin
    } catch {
      return false
    }
  }

  const xhrPrototype = target.XMLHttpRequest?.prototype
  if (xhrPrototype) {
    const blockedRequests = new WeakSet<XMLHttpRequest>()
    const open = xhrPrototype.open
    const send = xhrPrototype.send
    Object.defineProperty(xhrPrototype, 'open', {
      configurable: true,
      writable: true,
      value: function(this: XMLHttpRequest, method: string, url: string | URL, ...args: unknown[]) {
        if (isExternalUrl(url)) blockedRequests.add(this)
        else blockedRequests.delete(this)
        return Reflect.apply(open, this, [method, url, ...args])
      },
    })
    Object.defineProperty(xhrPrototype, 'send', {
      configurable: true,
      writable: true,
      value: function(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
        if (!blockedRequests.has(this)) return send.call(this, body)
        target.queueMicrotask(() => this.dispatchEvent(new target.ProgressEvent('error')))
      },
    })
  }

  const fetch = target.fetch?.bind(target)
  if (fetch) {
    target.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof target.Request ? input.url : input
      if (isExternalUrl(url)) return Promise.reject(new TypeError('External network is offline'))
      return fetch(input, init)
    }
  }

  if (typeof target.navigator.sendBeacon === 'function') {
    const sendBeacon = target.navigator.sendBeacon.bind(target.navigator)
    Object.defineProperty(target.navigator, 'sendBeacon', {
      configurable: true,
      value: (url: string | URL, data?: BodyInit | null) =>
        isExternalUrl(url) ? false : sendBeacon(url, data),
    })
  }
}
