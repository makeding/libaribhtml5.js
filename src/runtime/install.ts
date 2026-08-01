import { installRomSoundProtocol } from './romsound.ts'
import { installAribSymbolFont } from './fonts'
import { installBroadcastClock, type BroadcastNowProvider } from './clock'
import type {
  AribMediaPlane,
  AribMediaPlaneAdapter,
  AribMediaPlaneStackEntry,
} from '../media-plane'
import {
  deriveBroadcastRootUrl,
  normalizeBroadcastBaseUrl,
  resolveBroadcastUrl,
} from '../broadcast-url'
import {
  createBroadcastResourceCache,
  type BroadcastResourceCacheListener,
  type BroadcastResourceStore,
} from './resources'
import {
  createReceiverSystemInformation,
  readReceiverInformationArray,
  type ReceiverSystemInformationOverrides,
} from './system-information'
import { cloneProgramInfo, type ProgramInfo } from '../program-info'
import {
  resolveReceiverDeviceIdentifier,
  type ReceiverDeviceIdentifierProvider,
} from '../device-identifier'
import {
  runtimeEventMatchesSelector,
  sameRuntimeEventSelector,
  type RuntimeEvent,
  type RuntimeEventSelector,
} from './stream-event'

export type { ProgramInfo } from '../program-info'
export type {
  RuntimeEvent,
  RuntimeEventSelector,
  RuntimeEventSource,
} from './stream-event'

export type RuntimeWindow = Window & typeof globalThis & Record<string, unknown>

export type RuntimeOptions = {
  /** Permit HTTP requests outside the receiver-managed application origin. */
  allowExternalNetwork?: boolean
  /** Same-origin namespace where receiver-managed broadcast resources live. */
  broadcastBaseUrl?: string | URL
  /** Optional Worker/cache bridge used by storeDataResource(). */
  resourceStore?: BroadcastResourceStore
  /** Bind the broadcast object to a browser, native, or compositor media plane. */
  mediaPlaneAdapter?: AribMediaPlaneAdapter
  /** Return current broadcast time as Unix epoch milliseconds. */
  now?: BroadcastNowProvider
  /** Receiver identity/capabilities exposed by receiverDevice.getSystemInformation(). */
  systemInformation?: ReceiverSystemInformationOverrides
  /** Resolve receiver/CAS identifiers by receiverDevice identifier kind. */
  getDeviceIdentifier?: ReceiverDeviceIdentifierProvider
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

export function installRuntime(target: RuntimeWindow, options: RuntimeOptions = {}): void {
  if (target.__ARIB_HTML5_RUNTIME__) return
  target.__ARIB_HTML5_RUNTIME__ = 'installing'
  try {
    installRuntimeImplementation(target, options)
    target.__ARIB_HTML5_RUNTIME__ = true
  } catch (error) {
    delete target.__ARIB_HTML5_RUNTIME__
    throw error
  }
}

function installRuntimeImplementation(target: RuntimeWindow, options: RuntimeOptions): void {
  installBroadcastClock(target, options.now)
  installRomSoundProtocol(target)
  installAribSymbolFont(target)

  const broadcastBaseUrl = normalizeBroadcastBaseUrl(
    options.broadcastBaseUrl,
    target.location.href,
  )
  if (broadcastBaseUrl.origin !== target.location.origin) {
    throw new Error(`Broadcast base URL must be same-origin: ${broadcastBaseUrl.href}`)
  }
  const broadcastRootUrl = deriveBroadcastRootUrl(target.location.href, broadcastBaseUrl)
  const resolveRuntimeUrl = (value: unknown) => {
    const documentRelative = new URL(String(value ?? ''), target.location.href)
    return resolveBroadcastUrl(documentRelative, broadcastBaseUrl, broadcastRootUrl)
  }

  const runtimeId = target.crypto.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const postRuntime = (event: string, detail: Record<string, unknown> = {}) => {
    target.parent?.postMessage({
      type: 'arib-runtime',
      runtimeId,
      event,
      ...detail,
    }, '*')
  }

  // Broadcast resources are mounted on the receiver-managed origin. External
  // HTTP access represents the optional communication path and must fail
  // immediately when the host is offline; otherwise broadcaster connection
  // probes commonly wait for their full multi-second timeout.
  if (!options.allowExternalNetwork) {
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

  for (const [name, value] of Object.entries(keyValues)) target[name] = value

  const listeners = new Set<{
    selector: RuntimeEventSelector
    callback: (event: RuntimeEvent) => void
  }>()
  const eventIdListeners = new Set<() => void>()
  type CacheEventListener = BroadcastResourceCacheListener
  const resourceCache = createBroadcastResourceCache(
    target,
    (path) => resolveRuntimeUrl(path),
    options.resourceStore,
  )
  let programInfo: ProgramInfo | null = null
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
    if (event.data?.type !== 'arib-host' || event.data.runtimeId !== runtimeId) return
    if (event.data.event === 'caption-tracks') {
      captionTracks.clear()
      for (const value of event.data.componentTags ?? []) {
        const componentTag = Number(value)
        if (Number.isInteger(componentTag)) captionTracks.add(componentTag)
      }
      return
    }
    if (event.data.event === 'caption-reset') {
      captionTracks.clear()
      captionListeners.clear()
      return
    }
    if (event.data.event === 'caption-data') {
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
      return
    }
    if (event.data.event === 'program-info') {
      try {
        programInfo = event.data.value === null
          ? null
          : cloneProgramInfo(event.data.value as ProgramInfo)
      } catch (error) {
        postRuntime('error', { message: `Invalid program information: ${String(error)}` })
        return
      }
      for (const listener of eventIdListeners) queueMicrotask(listener)
      return
    }
    if (event.data.event === 'resource-change') {
      const change = event.data.change
      if (change === 'updated' || change === 'deleted') {
        resourceCache.change(String(event.data.path ?? ''), change)
      }
      return
    }
    if (event.data.event === 'stream-event') {
      const value = event.data.value as RuntimeEvent
      for (const listener of [...listeners]) {
        if (runtimeEventMatchesSelector(value, listener.selector)) listener.callback(value)
      }
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
    postRuntime('navigation-blocked', {
      url,
    })
  }
  const allowedNavigationUrl = (value: unknown): URL | null => {
    try {
      const url = resolveRuntimeUrl(value)
      // Broadcast application paths are signalled by MH-AIT and are not tied
      // to NHK's /sh4 or /sh8 directory convention. The host maps collected
      // broadcast resources into this origin; this is its sandbox policy, not
      // an implementation of the MH-AIT application-boundary descriptor.
      return url.origin === target.location.origin && /^https?:$/.test(url.protocol) ? url : null
    } catch {
      return null
    }
  }
  const installNavigationPolicy = () => {
    const nhksh = target.nhksh as Record<string, unknown> | undefined
    if (!nhksh || typeof nhksh.lu !== 'function' || nhksh.__navigationGuarded) return
    const navigate = nhksh.lu as (url: string, ...args: unknown[]) => unknown
    nhksh.lu = (url: string, ...args: unknown[]) => {
      const resolved = allowedNavigationUrl(url)
      if (!resolved) {
        reportBlockedNavigation(url)
        return false
      }
      return navigate.call(nhksh, resolved.href, ...args)
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
      const resolved = allowedNavigationUrl(url)
      if (!resolved) {
        reportBlockedNavigation(url)
        return null
      }
      target.location.href = resolved.href
      return ownerApplication
    },
    destroyApplication: () => {
      postRuntime('destroy')
    },
  }

  defineNavigatorProperty(target.navigator, 'applicationManager', {
    getOwnerApplication: () => ownerApplication,
  })

  const systemInformation = createReceiverSystemInformation(
    broadcastBaseUrl.href,
    options.systemInformation,
  )

  defineNavigatorProperty(target.navigator, 'receiverDevice', {
    getSystemInformation: () => ({ ...systemInformation }),
    getDeviceIdentifier: (kind: number, callback: (value: string) => void) => {
      // The default 48-bit value preserves the demo's existing ACAS display:
      // 0721 0721 0721 0724 9674. Product hosts can resolve each kind.
      queueMicrotask(() => {
        void resolveReceiverDeviceIdentifier(kind, options.getDeviceIdentifier).then(
          callback,
          () => callback(''),
        )
      })
    },
    getCurrentEventInformation: (callback: (value: ProgramInfo | null) => void) => {
      queueMicrotask(() => callback(programInfo ? cloneProgramInfo(programInfo) : null))
    },
    cacheEvent: {
      addCacheEventListener: (path: string, listener: CacheEventListener) => {
        return resourceCache.addListener(path, listener)
      },
      storeDataResource: (path: string, listener?: CacheEventListener) => {
        return resourceCache.store(path, listener)
      },
      releaseDataResource: (path?: string) => {
        return resourceCache.release(path)
      },
      removeCacheEventListener: (path: string, listener?: CacheEventListener) => {
        return resourceCache.removeListener(path, listener)
      },
    },
    streamEvent: {
      addGeneralEventMessageListener: (
        selector: RuntimeEventSelector,
        callback: (event: RuntimeEvent) => void,
      ) => {
        if (typeof callback !== 'function') return false
        listeners.add({ selector, callback })
        return true
      },
      removeGeneralEventMessageListener: (
        selector?: RuntimeEventSelector,
        callback?: (event: RuntimeEvent) => void,
      ) => {
        if (!selector) {
          listeners.clear()
          return true
        }
        for (const registration of [...listeners]) {
          if (sameRuntimeEventSelector(registration.selector, selector) &&
              (!callback || callback === registration.callback)) {
            listeners.delete(registration)
          }
        }
        return true
      },
      addEventIDUpdateListener: (callback: () => void) => {
        if (typeof callback !== 'function') return false
        eventIdListeners.add(callback)
        return true
      },
      removeEventIDUpdateListener: (callback?: () => void) => {
        if (callback) eventIdListeners.delete(callback)
        else eventIdListeners.clear()
        return true
      },
    },
  })

  defineNavigatorProperty(target.navigator, 'bmlCompat', {
    browserPseudo: {
      readPersistentArray: (namespace: string, structure: string) => {
        const raw = target.localStorage.getItem(`arib:nvram:${namespace}`)
        if (raw) {
          const value = JSON.parse(raw) as Record<string, unknown>
          return structure.split(',').map((field) => value[field] ?? null)
        }
        return readReceiverInformationArray(namespace, structure, systemInformation)
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

  const reportStageStyle = () => {
    const style = target.document.body
      ? target.getComputedStyle(target.document.body)
      : target.getComputedStyle(target.document.documentElement)
    postRuntime('stage-style', {
      backgroundColor: style.backgroundColor,
    })
  }
  const prepareExternalMediaPlaneCanvas = () => {
    if (options.mediaPlaneAdapter?.renderMode !== 'external') return
    target.document.documentElement.style.setProperty('background', 'transparent', 'important')
    if (target.document.body) {
      target.document.body.style.setProperty('background', 'transparent', 'important')
    }
  }
  const mediaPlaneAdapter = options.mediaPlaneAdapter
  const mediaObjectIds = new WeakMap<HTMLElement, string>()
  const externalObjectOpacity = new WeakMap<HTMLElement, {
    value: string
    priority: string
    computed: number
  }>()
  const externalBackgrounds = new Map<HTMLElement, {
    color: { value: string; priority: string }
    image: { value: string; priority: string }
  }>()
  let nextMediaObjectId = 1
  let activeMediaObject: HTMLElement | null = null
  let lastMediaPlane = ''
  let observedMediaObject: HTMLElement | null = null
  let mediaPlaneFrame: number | null = null
  let reportMediaPlane = () => undefined
  const activeMediaAnimation = (): boolean => {
    const mediaObject = activeMediaObject
    if (!mediaObject || typeof target.document.getAnimations !== 'function') return false
    return target.document.getAnimations().some(animation => {
      if (animation.playState !== 'running') return false
      const animated = (animation.effect as KeyframeEffect | null)?.target
      return animated instanceof target.Element && (
        animated === mediaObject || animated.contains(mediaObject) || mediaObject.contains(animated)
      )
    })
  }
  const scheduleMediaPlaneReport = () => {
    if (mediaPlaneFrame !== null) return
    mediaPlaneFrame = target.requestAnimationFrame(() => {
      mediaPlaneFrame = null
      reportMediaPlane()
      if (activeMediaAnimation()) scheduleMediaPlaneReport()
    })
  }
  const mediaPlaneResizeObserver = typeof target.ResizeObserver === 'function'
    ? new target.ResizeObserver(scheduleMediaPlaneReport)
    : null
  const observeMediaObject = (object: HTMLElement | null) => {
    if (object === observedMediaObject) return
    if (observedMediaObject) mediaPlaneResizeObserver?.unobserve(observedMediaObject)
    observedMediaObject = object
    if (object) mediaPlaneResizeObserver?.observe(object)
  }
  const logicalViewport = () => {
    const content = target.document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content ?? ''
    const width = Number(content.match(/(?:^|,)\s*width\s*=\s*(\d+)/i)?.[1] ?? 3840)
    const height = Number(content.match(/(?:^|,)\s*height\s*=\s*(\d+)/i)?.[1] ?? 2160)
    return { width, height }
  }
  const slotIdFor = (object: HTMLElement): string => {
    const existing = mediaObjectIds.get(object)
    if (existing) return existing
    const slotId = `media-plane-${nextMediaObjectId++}`
    mediaObjectIds.set(object, slotId)
    return slotId
  }
  const describeStackingPath = (object: HTMLElement): AribMediaPlaneStackEntry[] => {
    const path: AribMediaPlaneStackEntry[] = []
    let element: HTMLElement | null = object
    while (element) {
      const style = target.getComputedStyle(element)
      path.push({
        tagName: element.tagName.toLowerCase(),
        ...(element.id ? { id: element.id } : {}),
        position: style.position,
        zIndex: style.zIndex,
        display: style.display,
        visibility: style.visibility,
        opacity: externalObjectOpacity.get(element)?.computed ?? Number(style.opacity),
        transform: style.transform,
      })
      element = element.parentElement
    }
    return path.reverse()
  }
  const setExternalPlaceholder = (object: HTMLElement, enabled: boolean) => {
    if (enabled) {
      if (!externalObjectOpacity.has(object)) {
        externalObjectOpacity.set(object, {
          value: object.style.getPropertyValue('opacity'),
          priority: object.style.getPropertyPriority('opacity'),
          computed: Number(target.getComputedStyle(object).opacity),
        })
      }
      if (object.style.getPropertyValue('opacity') !== '0' ||
          object.style.getPropertyPriority('opacity') !== 'important') {
        object.style.setProperty('opacity', '0', 'important')
      }
      return
    }
    const original = externalObjectOpacity.get(object)
    if (!original) return
    if (original.value) object.style.setProperty('opacity', original.value, original.priority)
    else object.style.removeProperty('opacity')
    externalObjectOpacity.delete(object)
  }
  const restoreExternalBackground = (element: HTMLElement) => {
    const original = externalBackgrounds.get(element)
    if (!original) return
    for (const [property, value] of [
      ['background-color', original.color],
      ['background-image', original.image],
    ] as const) {
      if (value.value) element.style.setProperty(property, value.value, value.priority)
      else element.style.removeProperty(property)
    }
    externalBackgrounds.delete(element)
  }
  const restoreExternalBackgrounds = () => {
    for (const element of [...externalBackgrounds.keys()]) {
      restoreExternalBackground(element)
    }
  }
  const setExternalMediaHole = (object: HTMLElement, enabled: boolean) => {
    setExternalPlaceholder(object, enabled)
    if (!enabled) {
      restoreExternalBackgrounds()
      return
    }

    // An external video surface sits below the iframe. Making only the media
    // object transparent is insufficient when an ancestor or another
    // application layer paints an opaque rectangle over the media slot.
    // Clear backgrounds only; element content remains on the application plane.
    const desired = new Set<HTMLElement>()
    for (let element = object.parentElement;
      element && element !== target.document.body &&
      element !== target.document.documentElement;
      element = element.parentElement) {
      const style = target.getComputedStyle(element)
      if (!externalBackgrounds.has(element) &&
          (style.backgroundColor === 'rgba(0, 0, 0, 0)' ||
           style.backgroundColor === 'transparent') &&
          style.backgroundImage === 'none') continue
      desired.add(element)
    }
    const objectRect = object.getBoundingClientRect()
    const coversMediaSlot = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect()
      const tolerance = 1
      return rect.width > 0 && rect.height > 0 &&
        rect.left <= objectRect.left + tolerance &&
        rect.top <= objectRect.top + tolerance &&
        rect.right >= objectRect.right - tolerance &&
        rect.bottom >= objectRect.bottom - tolerance
    }
    for (const element of target.document.querySelectorAll<HTMLElement>('body *')) {
      if (element === object || element.contains(object) || object.contains(element)) continue
      const style = target.getComputedStyle(element)
      if ((style.backgroundColor === 'rgba(0, 0, 0, 0)' ||
           style.backgroundColor === 'transparent') &&
          style.backgroundImage === 'none') continue
      // Only the background paint is removed. Text, controls and transparent
      // overlays such as a caption debug layer remain in the iframe.
      if (coversMediaSlot(element)) desired.add(element)
    }
    for (const element of [...externalBackgrounds.keys()]) {
      if (!desired.has(element)) restoreExternalBackground(element)
    }
    for (const element of desired) {
      if (externalBackgrounds.has(element)) continue
      externalBackgrounds.set(element, {
        color: {
          value: element.style.getPropertyValue('background-color'),
          priority: element.style.getPropertyPriority('background-color'),
        },
        image: {
          value: element.style.getPropertyValue('background-image'),
          priority: element.style.getPropertyPriority('background-image'),
        },
      })
      element.style.setProperty('background-color', 'transparent', 'important')
      element.style.setProperty('background-image', 'none', 'important')
    }
  }
  const callMediaPlaneAdapter = (callback: () => void) => {
    try {
      callback()
    } catch (error) {
      postRuntime('error', {
        message: `Media-plane adapter failed: ${String(error)}`,
      })
    }
  }
  const unmountMediaPlane = (reason: 'slot-removed' | 'document-unload') => {
    if (activeMediaObject) setExternalMediaHole(activeMediaObject, false)
    else restoreExternalBackgrounds()
    if (mediaPlaneAdapter) {
      callMediaPlaneAdapter(() => mediaPlaneAdapter.unmountMediaPlane(reason))
    }
    activeMediaObject = null
  }
  reportMediaPlane = () => {
    const object = target.document.querySelector<HTMLElement>(
      'object[type="video/x-arib2-broadcast"], ' +
      'object[data-arib-type="video/x-arib2-broadcast"]',
    )
    if (!object) {
      observeMediaObject(null)
      const removedSlotId = activeMediaObject ? slotIdFor(activeMediaObject) : ''
      if (activeMediaObject) unmountMediaPlane('slot-removed')
      const screen = logicalViewport()
      const plane: AribMediaPlane = {
        slotId: removedSlotId,
        visible: false,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        screenWidth: screen.width,
        screenHeight: screen.height,
        layer: { documentOrder: -1, stackingPath: [] },
      }
      const message = JSON.stringify(plane)
      if (message !== lastMediaPlane) {
        lastMediaPlane = message
        postRuntime('media-plane', plane)
      }
      return
    }
    observeMediaObject(object)
    installBroadcastObjectApi(object as BroadcastObject)
    const rect = object.getBoundingClientRect()
    const style = target.getComputedStyle(object)
    const videoSource = object.querySelector<HTMLParamElement>('param[name="video_src"]')?.value
    const audioSource = object.querySelector<HTMLParamElement>('param[name="audio_src"]')?.value
    const screen = logicalViewport()
    const stackingPath = describeStackingPath(object)
    const plane: AribMediaPlane = {
      slotId: slotIdFor(object),
      visible: style.display !== 'none' && style.visibility !== 'hidden' &&
        rect.width > 0 && rect.height > 0 &&
        stackingPath.every((entry) => entry.display !== 'none' &&
          entry.visibility !== 'hidden' && entry.opacity > 0),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      screenWidth: screen.width,
      screenHeight: screen.height,
      videoSource,
      audioSource,
      layer: {
        documentOrder: Array.from(target.document.querySelectorAll('*')).indexOf(object),
        stackingPath,
      },
    }
    const message = JSON.stringify(plane)
    if (object !== activeMediaObject) {
      if (activeMediaObject) unmountMediaPlane('slot-removed')
      activeMediaObject = object
      if (mediaPlaneAdapter) {
        callMediaPlaneAdapter(() => mediaPlaneAdapter.mountMediaPlane(object, plane))
      }
    } else if (message !== lastMediaPlane && mediaPlaneAdapter) {
      callMediaPlaneAdapter(() => mediaPlaneAdapter.updateMediaPlane(object, plane))
    }
    setExternalMediaHole(object, (mediaPlaneAdapter?.renderMode ?? 'external') === 'external')
    if (message === lastMediaPlane) return
    lastMediaPlane = message
    postRuntime('media-plane', plane)
  }
  const startDocumentRuntime = () => {
    installNavigationPolicy()
    reportStageStyle()
    prepareExternalMediaPlaneCanvas()
    reportMediaPlane()
  }

  // Establish the host session before observing the parser.  A broadcast
  // object can be inserted while this bootstrap script is still running; if
  // its first video-plane report precedes "installed", the host has no
  // runtime id to associate it with and must discard it.
  postRuntime('installed', { url: target.location.href })
  if (target.document.readyState === 'loading') {
    target.document.addEventListener('DOMContentLoaded', startDocumentRuntime, { once: true })
  } else {
    queueMicrotask(startDocumentRuntime)
  }
  target.document.addEventListener('click', (event) => {
    const element = event.target instanceof target.Element ? event.target : null
    const anchor = element?.closest<HTMLAnchorElement>('a[href]')
    if (!anchor) return
    const resolved = allowedNavigationUrl(anchor.href)
    if (resolved && resolved.href === anchor.href) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (resolved) target.location.href = resolved.href
    else reportBlockedNavigation(anchor.href)
  }, true)
  const mediaPlaneMutationObserver = new target.MutationObserver(scheduleMediaPlaneReport)
  mediaPlaneMutationObserver.observe(target.document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style', 'type', 'data-arib-type', 'name', 'value'],
    childList: true,
    subtree: true,
  })
  mediaPlaneResizeObserver?.observe(target.document.documentElement)
  target.addEventListener('resize', scheduleMediaPlaneReport)
  for (const event of ['animationstart', 'animationend', 'animationcancel',
    'transitionrun', 'transitionend', 'transitioncancel']) {
    target.document.addEventListener(event, scheduleMediaPlaneReport, true)
  }
  // Also synchronize once after the installed message even when the document
  // has already been parsed and no mutation follows runtime installation.
  queueMicrotask(scheduleMediaPlaneReport)

  target.addEventListener('pagehide', () => {
    if (mediaPlaneFrame !== null) target.cancelAnimationFrame(mediaPlaneFrame)
    mediaPlaneFrame = null
    mediaPlaneMutationObserver.disconnect()
    mediaPlaneResizeObserver?.disconnect()
    target.removeEventListener('resize', scheduleMediaPlaneReport)
    resourceCache.dispose()
    unmountMediaPlane('document-unload')
    postRuntime('unloading', { url: target.location.href })
  })

  target.addEventListener('error', (event) => {
    postRuntime('error', {
      message: event.message,
    })
  })
}
