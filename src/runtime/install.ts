type RuntimeWindow = Window & typeof globalThis & Record<string, unknown>

type RuntimeEvent = {
  source: { event_message_tag: number }
  message_id: number
  private_data_byte: string
}

type CaptionListener = (data: string) => void

type BroadcastObject = HTMLElement & {
  isCaptionExistent?: (source: string) => boolean
  addCaptionListener?: (listener: CaptionListener, source: string) => boolean
  removeCaptionListener?: (listener: CaptionListener) => boolean
}

const keyValues: Record<string, number> = {
  VK_0: 48,
  VK_1: 49,
  VK_2: 50,
  VK_3: 51,
  VK_4: 52,
  VK_5: 53,
  VK_6: 54,
  VK_7: 55,
  VK_8: 56,
  VK_9: 57,
  VK_10: 410,
  VK_11: 411,
  VK_12: 412,
  VK_ENTER: 13,
  VK_LEFT: 37,
  VK_UP: 38,
  VK_RIGHT: 39,
  VK_DOWN: 40,
  VK_RED: 403,
  VK_GREEN: 404,
  VK_YELLOW: 405,
  VK_BLUE: 406,
  VK_BACK: 461,
  VK_DBUTTON: 457,
}

function defineNavigatorProperty(target: Navigator, name: string, value: unknown): void {
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    value,
  })
}

export function installRuntime(target: RuntimeWindow): void {
  if (target.__ARIB_HTML5_RUNTIME__) return
  target.__ARIB_HTML5_RUNTIME__ = true

  for (const [name, value] of Object.entries(keyValues)) target[name] = value

  const listeners = new Map<string, Set<(event: RuntimeEvent) => void>>()
  const listenerKey = (source: { event_message_tag?: number }, id?: number) =>
    `${source?.event_message_tag ?? 0}:${id ?? 0}`

  const captionTracks = new Set<number>()
  const captionListeners = new Map<CaptionListener, number>()
  const captionComponentTag = (source: string): number | null => {
    const value = source.match(/\/([0-9a-f]{4})(?:[?#]|$)/i)?.[1]
    return value === undefined ? null : Number.parseInt(value, 16)
  }
  const installBroadcastObjectApi = (object: BroadcastObject) => {
    if (typeof object.isCaptionExistent !== 'function') {
      object.isCaptionExistent = (source: string) => {
        const componentTag = captionComponentTag(source)
        return componentTag !== null && captionTracks.has(componentTag)
      }
    }
    if (typeof object.addCaptionListener !== 'function') {
      object.addCaptionListener = (listener: CaptionListener, source: string) => {
        const componentTag = captionComponentTag(source)
        if (typeof listener !== 'function' || componentTag === null) return false
        captionListeners.set(listener, componentTag)
        return true
      }
    }
    if (typeof object.removeCaptionListener !== 'function') {
      object.removeCaptionListener = (listener: CaptionListener) => captionListeners.delete(listener)
    }
  }

  target.addEventListener('message', (event) => {
    if (event.source !== target.parent || event.origin !== target.location.origin) return
    if (event.data?.type !== 'arib-caption') return
    if (event.data.event === 'tracks') {
      captionTracks.clear()
      for (const value of event.data.componentTags ?? []) {
        const componentTag = Number(value)
        if (Number.isInteger(componentTag)) captionTracks.add(componentTag)
      }
      return
    }
    if (event.data.event === 'reset') {
      captionTracks.clear()
      captionListeners.clear()
      return
    }
    if (event.data.event !== 'data') return
    const componentTag = Number(event.data.componentTag)
    const payload = typeof event.data.payload === 'string'
      ? event.data.payload
      : JSON.stringify({
          data_type: String(event.data.dataType ?? '0000'),
          TMD: String(event.data.tmd ?? ''),
          data: String(event.data.data ?? ''),
        })
    for (const [listener, registeredTag] of captionListeners) {
      if (registeredTag === componentTag) listener(payload)
    }
  })

  const keySet = {
    RED: 1 << 0,
    GREEN: 1 << 1,
    YELLOW: 1 << 2,
    BLUE: 1 << 3,
    NAVIGATION: 1 << 4,
    DBUTTON: 1 << 5,
    value: 0,
    setValue(value: number) {
      this.value = value
      return true
    },
  }

  const reportBlockedNavigation = (value: unknown) => {
    let url = String(value ?? '')
    try {
      url = new URL(url, target.location.href).href
    } catch {
      // Keep the original value for diagnostics.
    }
    target.parent?.postMessage({
      type: 'arib-runtime',
      event: 'navigation-blocked',
      url,
    }, '*')
  }
  const isAllowedNavigation = (value: unknown): boolean => {
    try {
      const url = new URL(String(value), target.location.href)
      if (url.origin !== target.location.origin) return false
      return /^\/(?:sh[48]|[4567][012])\//.test(url.pathname)
    } catch {
      return false
    }
  }
  const installNavigationPolicy = () => {
    const nhksh = target.nhksh as Record<string, unknown> | undefined
    if (!nhksh || typeof nhksh.lu !== 'function' || nhksh.__navigationGuarded) return
    const navigate = nhksh.lu as (url: string, ...args: unknown[]) => unknown
    nhksh.lu = (url: string, ...args: unknown[]) => {
      if (!isAllowedNavigation(url)) {
        reportBlockedNavigation(url)
        return false
      }
      return navigate.call(nhksh, url, ...args)
    }
    nhksh.__navigationGuarded = true
  }

  const ownerApplication = {
    keySet,
    show: () => true,
    hide: () => true,
    activateInput: () => true,
    deactivateInput: () => true,
    createApplication: (url: string) => {
      if (!isAllowedNavigation(url)) {
        reportBlockedNavigation(url)
        return null
      }
      target.location.href = url
      return ownerApplication
    },
    destroyApplication: () => {
      target.parent?.postMessage({ type: 'arib-runtime', event: 'destroy' }, '*')
    },
  }

  defineNavigatorProperty(target.navigator, 'applicationManager', {
    getOwnerApplication: () => ownerApplication,
  })

  const systemInformation = {
    browsername: 'libaribhtml5',
    browserversion: '0.1.0',
    makerid: 'codex',
    modelname: 'vite-prototype',
    baseurl: `${target.location.origin}/`,
  }

  defineNavigatorProperty(target.navigator, 'receiverDevice', {
    getSystemInformation: () => ({ ...systemInformation }),
    getDeviceIdentifier: (_kind: number, callback: (value: string) => void) => {
      // nhksh.getCAS10() converts this 48-bit receiver identifier to the
      // decimal ACAS number and appends its five-digit XOR check value.
      // This produces: 0721 0721 0721 0724 9674.
      queueMicrotask(() => callback('4194c4ae4730'))
    },
    getCurrentEventInformation: (callback: (value: unknown) => void) => {
      queueMicrotask(() => callback({
        original_network_id: 4,
        transport_stream_id: 11,
        service_id: 101,
        event_id: 1,
        event_name: 'BS4Kデモ',
      }))
    },
    cacheEvent: {
      storeDataResource: (_url: string, callback?: (...args: unknown[]) => void) => {
        callback?.('cached')
        return true
      },
      releaseDataResource: () => true,
      removeCacheEventListener: () => true,
    },
    streamEvent: {
      addGeneralEventMessageListener: (
        selector: { source: { event_message_tag?: number }; message_id?: number },
        callback: (event: RuntimeEvent) => void,
      ) => {
        const key = listenerKey(selector.source, selector.message_id)
        if (!listeners.has(key)) listeners.set(key, new Set())
        listeners.get(key)?.add(callback)
        return true
      },
      removeGeneralEventMessageListener: (
        selector?: { source?: { event_message_tag?: number }; message_id?: number },
        callback?: (event: RuntimeEvent) => void,
      ) => {
        if (!selector?.source) {
          listeners.clear()
          return true
        }
        const key = listenerKey(selector.source, selector.message_id)
        if (callback) listeners.get(key)?.delete(callback)
        else listeners.delete(key)
        return true
      },
      removeEventIDUpdateListener: () => true,
    },
  })

  defineNavigatorProperty(target.navigator, 'bmlCompat', {
    browserPseudo: {
      readPersistentArray: (namespace: string, structure: string) => {
        const raw = target.localStorage.getItem(`arib:nvram:${namespace}`)
        if (!raw) return null
        const value = JSON.parse(raw) as Record<string, unknown>
        return structure.split(',').map((field) => value[field] ?? null)
      },
      writePersistentArray: (namespace: string, structure: string, values: unknown[]) => {
        const output = Object.fromEntries(
          structure.split(',').map((field, index) => [field, values[index]]),
        )
        target.localStorage.setItem(`arib:nvram:${namespace}`, JSON.stringify(output))
        return values.length
      },
    },
  })

  const makeTransparent = () => {
    target.document.documentElement.style.setProperty('background', 'transparent', 'important')
    if (target.document.body) {
      target.document.body.style.setProperty('background', 'transparent', 'important')
    }
  }
  const reportStageStyle = () => {
    const style = target.document.body
      ? target.getComputedStyle(target.document.body)
      : target.getComputedStyle(target.document.documentElement)
    target.parent?.postMessage({
      type: 'arib-runtime',
      event: 'stage-style',
      backgroundColor: style.backgroundColor,
    }, '*')
  }
  let lastVideoPlane = ''
  const logicalViewport = () => {
    const content = target.document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content ?? ''
    const width = Number(content.match(/(?:^|,)\s*width\s*=\s*(\d+)/i)?.[1] ?? 3840)
    const height = Number(content.match(/(?:^|,)\s*height\s*=\s*(\d+)/i)?.[1] ?? 2160)
    return { width, height }
  }
  const reportVideoPlane = () => {
    const object = target.document.querySelector<HTMLElement>(
      'object[type="video/x-arib2-broadcast"]',
    )
    if (!object) {
      const message = JSON.stringify({ visible: false })
      if (message !== lastVideoPlane) {
        lastVideoPlane = message
        target.parent?.postMessage({
          type: 'arib-runtime',
          event: 'video-plane',
          visible: false,
        }, '*')
      }
      return
    }
    const rect = object.getBoundingClientRect()
    const style = target.getComputedStyle(object)
    const videoSource = object.querySelector<HTMLParamElement>('param[name="video_src"]')?.value
    const audioSource = object.querySelector<HTMLParamElement>('param[name="audio_src"]')?.value
    const screen = logicalViewport()
    const plane = {
      visible: style.display !== 'none' && style.visibility !== 'hidden' &&
        rect.width > 0 && rect.height > 0,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      screenWidth: screen.width,
      screenHeight: screen.height,
      videoSource,
      audioSource,
    }
    const message = JSON.stringify(plane)
    if (message === lastVideoPlane) return
    lastVideoPlane = message
    target.parent?.postMessage({
      type: 'arib-runtime',
      event: 'video-plane',
      ...plane,
    }, '*')
  }
  const exposeBroadcastVideo = () => {
    target.document
      .querySelectorAll<BroadcastObject>('object[type="video/x-arib2-broadcast"]')
      .forEach((object) => {
        installBroadcastObjectApi(object)
        object.style.setProperty('opacity', '0', 'important')
        object.style.setProperty('pointer-events', 'none', 'important')
        object.parentElement?.style.setProperty('background', 'transparent', 'important')
      })
    reportVideoPlane()
  }
  target.document.addEventListener('DOMContentLoaded', () => {
    installNavigationPolicy()
    reportStageStyle()
    makeTransparent()
    exposeBroadcastVideo()
  }, { once: true })
  target.document.addEventListener('click', (event) => {
    const element = event.target instanceof target.Element ? event.target : null
    const anchor = element?.closest<HTMLAnchorElement>('a[href]')
    if (!anchor || isAllowedNavigation(anchor.href)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    reportBlockedNavigation(anchor.href)
  }, true)
  new MutationObserver(exposeBroadcastVideo).observe(target.document.documentElement, {
    childList: true,
    subtree: true,
  })
  target.setInterval(reportVideoPlane, 100)

  target.addEventListener('pagehide', () => {
    target.parent?.postMessage({
      type: 'arib-runtime',
      event: 'video-plane',
      visible: false,
    }, '*')
  })

  target.addEventListener('error', (event) => {
    target.parent?.postMessage({
      type: 'arib-runtime',
      event: 'error',
      message: event.message,
    }, '*')
  })
  target.parent?.postMessage({ type: 'arib-runtime', event: 'installed' }, '*')
}
