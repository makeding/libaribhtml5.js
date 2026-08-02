import { installRomSoundProtocol } from './romsound.ts'
import { installAribSymbolFont } from './fonts'
import { installBroadcastClock, type BroadcastNowProvider } from './clock'
import type {
  AribMediaPlane,
  AribMediaPlaneAdapter,
  AribMediaPlaneStackEntry,
} from '../media-plane'
import { resolveBroadcastMediaSlot } from './media-slot'
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
  synchronizeReceiverCompatibilityStorage,
  type ReceiverSystemInformationOverrides,
} from './system-information'
import { cloneProgramInfo, type ProgramInfo } from '../program-info'
import {
  getDefaultReceiverIrdId,
  resolveReceiverDeviceIdentifier,
  type ReceiverDeviceIdentifierProvider,
} from '../device-identifier'
import {
  runtimeEventMatchesSelector,
  sameRuntimeEventSelector,
  type RuntimeEvent,
  type RuntimeEventSelector,
} from './stream-event'
import {
  ARIB_PERMISSION_BITS,
  AribApplicationBoundaryPolicy,
  type AribPermissionManagedArea,
  type AribPermissionBit,
  type RuntimePermissionManagedArea,
} from './application-boundary'

export type { ProgramInfo } from '../program-info'
export type {
  RuntimeEvent,
  RuntimeEventSelector,
  RuntimeEventSource,
} from './stream-event'
export type {
  AribPermissionManagedArea,
  RuntimePermissionManagedArea,
} from './application-boundary'

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
  /** MH-AIT metadata for the application which owns this document. */
  application?: RuntimeApplicationInformation
}

export type RuntimeApplicationInformation = {
  type?: string
  organizationId?: number
  applicationId?: number
  controlCode?: string
  autostartPriority?: number
  /** Decoded loops from MH-AIT descriptor 0x802C. Omit when absent. */
  permissionManagedAreas?: readonly RuntimePermissionManagedArea[]
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
  let applicationInformation: RuntimeApplicationInformation = { ...options.application }
  const applicationBoundary = new AribApplicationBoundaryPolicy(
    broadcastBaseUrl,
    target.location.href,
    applicationInformation.permissionManagedAreas,
  )
  const notAuthorized = (): Error => {
    const error = new Error('Not authorized') as Error & { code?: string }
    error.name = 'Error'
    error.code = 'NOT_AUTHORIZED_ERR'
    return error
  }
  const requirePermission = (bit: AribPermissionBit): void => {
    if (!applicationBoundary.permits(target.location.href, bit)) throw notAuthorized()
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
  const reportCaptionSubscriptions = () => {
    postRuntime('caption-subscription', {
      componentTags: [...new Set(captionListeners.values())],
    })
  }
  const installBroadcastObjectApi = (object: BroadcastObject) => {
    if (typeof object.isCaptionExistent !== 'function') {
      object.isCaptionExistent = (source: string) => {
        requirePermission(ARIB_PERMISSION_BITS.broadcastMedia)
        const componentTag = captionComponentTag(source)
        return componentTag !== null && captionTracks.has(componentTag)
      }
    }
    if (typeof object.addCaptionListener !== 'function') {
      object.addCaptionListener = (listener: CaptionListener, source: string) => {
        requirePermission(ARIB_PERMISSION_BITS.broadcastMedia)
        const componentTag = captionComponentTag(source)
        if (typeof listener !== 'function' || componentTag === null) return false
        captionListeners.set(listener, componentTag)
        reportCaptionSubscriptions()
        return true
      }
    }
    if (typeof object.removeCaptionListener !== 'function') {
      object.removeCaptionListener = (listener: CaptionListener) => {
        requirePermission(ARIB_PERMISSION_BITS.broadcastMedia)
        const removed = captionListeners.delete(listener)
        if (removed) reportCaptionSubscriptions()
        return removed
      }
    }
  }

  let applyApplicationInformation: (value: RuntimeApplicationInformation) => void = () => {}
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
      reportCaptionSubscriptions()
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
    if (event.data.event === 'application-information') {
      try {
        applyApplicationInformation(event.data.value ?? {})
      } catch (error) {
        postRuntime('error', { message: `Invalid application information: ${String(error)}` })
      }
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
      if (!/^https?:$/.test(url.protocol)) return null
      if (url.origin !== target.location.origin && !options.allowExternalNetwork) return null
      return applicationBoundary.evaluate(url).withinBoundary ? url : null
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

  const boundaryDescriptor = {
    getCurrentBoundary: () => {
      requirePermission(ARIB_PERMISSION_BITS.broadcastResources)
      return applicationBoundary.getCurrentBoundary()
    },
    addPermissionManagedArea: (area: AribPermissionManagedArea) => {
      requirePermission(ARIB_PERMISSION_BITS.boundaryExtension)
      applicationBoundary.addPermissionManagedArea(area)
    },
  }
  const ownerApplication = {
    type: applicationInformation.type ?? '',
    organization_id: applicationInformation.organizationId ?? 0,
    application_id: applicationInformation.applicationId ?? 0,
    control_code: applicationInformation.controlCode ?? '',
    autostart_priority: applicationInformation.autostartPriority ?? 0,
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
    replaceApplication: (
      organizationId: number,
      applicationId: number,
      aitUrl: string | null = null,
    ) => {
      requirePermission(ARIB_PERMISSION_BITS.broadcastResources)
      if (!Number.isSafeInteger(organizationId) || organizationId < 0 ||
          !Number.isSafeInteger(applicationId) || applicationId < 0) {
        postRuntime('error', { message: 'Invalid replaceApplication application identifier' })
        return
      }
      postRuntime('replace-application', {
        organizationId,
        applicationId,
        aitUrl: aitUrl === null ? null : String(aitUrl),
      })
    },
    exitFromManagedState: (url: string) => {
      requirePermission(ARIB_PERMISSION_BITS.broadcastResources)
      postRuntime('exit-managed-state', { url: String(url ?? '') })
    },
    getApplicationBoundaryAndPermissionDescriptor: () => {
      requirePermission(ARIB_PERMISSION_BITS.broadcastResources)
      return applicationBoundary.hasDescriptor() ? boundaryDescriptor : null
    },
  }

  applyApplicationInformation = (value: RuntimeApplicationInformation) => {
    const next = { ...value }
    applicationBoundary.update(next.permissionManagedAreas)
    applicationInformation = next
    ownerApplication.type = applicationInformation.type ?? ''
    ownerApplication.organization_id = applicationInformation.organizationId ?? 0
    ownerApplication.application_id = applicationInformation.applicationId ?? 0
    ownerApplication.control_code = applicationInformation.controlCode ?? ''
    ownerApplication.autostart_priority = applicationInformation.autostartPriority ?? 0
    scheduleMediaPlaneReport()
    if (!applicationBoundary.evaluate(target.location.href).withinBoundary) {
      postRuntime('application-boundary-exit', { url: target.location.href })
    }
  }

  defineNavigatorProperty(target.navigator, 'applicationManager', {
    getOwnerApplication: () => ownerApplication,
  })

  const systemInformation = createReceiverSystemInformation(
    broadcastBaseUrl.href,
    options.systemInformation,
  )
  synchronizeReceiverCompatibilityStorage(target.localStorage, systemInformation)

  defineNavigatorProperty(target.navigator, 'receiverDevice', {
    confirmIPNetwork: () => options.allowExternalNetwork ?? false,
    getSystemInformation: () => {
      requirePermission(ARIB_PERMISSION_BITS.broadcastResources)
      return { ...systemInformation }
    },
    getDeviceIdentifier: (kind: number, callback: (value: string) => void) => {
      requirePermission(ARIB_PERMISSION_BITS.deviceIdentifier)
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
      requirePermission(ARIB_PERMISSION_BITS.currentEventInformation)
      queueMicrotask(() => callback(programInfo ? cloneProgramInfo(programInfo) : null))
    },
    cacheEvent: {
      addCacheEventListener: (path: string, listener: CacheEventListener) => {
        requirePermission(ARIB_PERMISSION_BITS.broadcastResources)
        return resourceCache.addListener(path, listener)
      },
      storeDataResource: (path: string, listener?: CacheEventListener) => {
        requirePermission(ARIB_PERMISSION_BITS.broadcastResources)
        return resourceCache.store(path, listener)
      },
      releaseDataResource: (path?: string) => {
        requirePermission(ARIB_PERMISSION_BITS.broadcastResources)
        return resourceCache.release(path)
      },
      removeCacheEventListener: (path: string, listener?: CacheEventListener) => {
        requirePermission(ARIB_PERMISSION_BITS.broadcastResources)
        return resourceCache.removeListener(path, listener)
      },
    },
    streamEvent: {
      addGeneralEventMessageListener: (
        selector: RuntimeEventSelector,
        callback: (event: RuntimeEvent) => void,
      ) => {
        requirePermission(ARIB_PERMISSION_BITS.broadcastResources)
        if (typeof callback !== 'function') return false
        listeners.add({ selector, callback })
        return true
      },
      removeGeneralEventMessageListener: (
        selector?: RuntimeEventSelector,
        callback?: (event: RuntimeEvent) => void,
      ) => {
        requirePermission(ARIB_PERMISSION_BITS.broadcastResources)
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
        requirePermission(ARIB_PERMISSION_BITS.broadcastResources)
        if (typeof callback !== 'function') return false
        eventIdListeners.add(callback)
        return true
      },
      removeEventIDUpdateListener: (callback?: () => void) => {
        requirePermission(ARIB_PERMISSION_BITS.broadcastResources)
        if (callback) eventIdListeners.delete(callback)
        else eventIdListeners.clear()
        return true
      },
    },
  })

  defineNavigatorProperty(target.navigator, 'bmlCompat', {
    browserPseudo: {
      // Older broadcaster applications use the synchronous BML API instead
      // of receiverDevice.getDeviceIdentifier(). Keep both paths on the same
      // stable demo ACAS identifier.
      getIRDID: (type: number) => {
        requirePermission(ARIB_PERMISSION_BITS.deviceIdentifier)
        return getDefaultReceiverIrdId(type)
      },
      readPersistentArray: (namespace: string, structure: string) => {
        requirePermission(ARIB_PERMISSION_BITS.persistentStorage)
        const raw = target.localStorage.getItem(`arib:nvram:${namespace}`)
        if (raw) {
          const value = JSON.parse(raw) as Record<string, unknown>
          return structure.split(',').map((field) => value[field] ?? null)
        }
        return readReceiverInformationArray(namespace, structure, systemInformation)
      },
      writePersistentArray: (namespace: string, structure: string, values: unknown[]) => {
        requirePermission(ARIB_PERMISSION_BITS.persistentStorage)
        const output = Object.fromEntries(
          structure.split(',').map((field, index) => [field, values[index]]),
        )
        target.localStorage.setItem(`arib:nvram:${namespace}`, JSON.stringify(output))
        return values.length
      },
    },
  })

  const reportStageStyle = () => {
    const body = target.document.body
    const style = target.getComputedStyle(body ?? target.document.documentElement)
    let backgroundColor = style.backgroundColor
    const canvasRect = body?.getBoundingClientRect()
    if (canvasRect && canvasRect.width > 0 && canvasRect.height > 0) {
      const tolerance = 1
      for (const element of target.document.querySelectorAll<HTMLElement>('body *')) {
        const candidateStyle = target.getComputedStyle(element)
        if (candidateStyle.backgroundColor === 'rgba(0, 0, 0, 0)' ||
            candidateStyle.backgroundColor === 'transparent') continue
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0 ||
            rect.left > canvasRect.left + tolerance ||
            rect.top > canvasRect.top + tolerance ||
            rect.right < canvasRect.right - tolerance ||
            rect.bottom < canvasRect.bottom - tolerance) continue
        // Caption applications commonly put the real black stage in a
        // full-canvas #backscreen while leaving body white. Preserve that
        // stage below the external video before the media hole clears it.
        backgroundColor = candidateStyle.backgroundColor
        break
      }
    }
    postRuntime('stage-style', {
      backgroundColor,
    })
  }
  const prepareExternalMediaPlaneCanvas = () => {
    if (options.mediaPlaneAdapter?.renderMode !== 'external') return
    // Chromium paints an opaque iframe canvas when the used color scheme of
    // the owner iframe and this document root differ. Broadcast applications
    // predate page color-scheme negotiation, so pin the child side to the
    // receiver's light canvas instead of inheriting the host's dark preference.
    target.document.documentElement.style.setProperty('color-scheme', 'only light', 'important')
    target.document.documentElement.style.setProperty('background', 'transparent', 'important')
    if (target.document.body) {
      target.document.body.style.setProperty('background', 'transparent', 'important')
    }
  }
  const mediaPlaneAdapter = options.mediaPlaneAdapter
  const mediaObjectIds = new WeakMap<HTMLElement, string>()
  const externalPlaceholderOpacities = new Map<HTMLElement, {
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
  let stageStyleReported = false
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
        opacity: externalPlaceholderOpacities.get(element)?.computed ?? Number(style.opacity),
        transform: style.transform,
      })
      element = element.parentElement
    }
    return path.reverse()
  }
  const externalPlaceholderElements = (object: HTMLElement): HTMLElement[] => {
    const elements = [object]
    const slot = resolveBroadcastMediaSlot(object)
    const objectRect = slot.rect
    const tolerance = 1
    let child = object
    for (let parent = object.parentElement;
      parent && parent !== target.document.body &&
      parent !== target.document.documentElement;
      parent = parent.parentElement) {
      const rect = parent.getBoundingClientRect()
      const isMediaOnlyWrapper = parent.children.length === 1 &&
        parent.firstElementChild === child &&
        (parent === slot.element || (
          Math.abs(rect.left - objectRect.left) <= tolerance &&
          Math.abs(rect.top - objectRect.top) <= tolerance &&
          Math.abs(rect.width - objectRect.width) <= tolerance &&
          Math.abs(rect.height - objectRect.height) <= tolerance
        ))
      if (!isMediaOnlyWrapper) break
      elements.push(parent)
      child = parent
    }
    return elements
  }
  const restoreExternalPlaceholder = (element: HTMLElement) => {
    const original = externalPlaceholderOpacities.get(element)
    if (!original) return
    if (original.value) element.style.setProperty('opacity', original.value, original.priority)
    else element.style.removeProperty('opacity')
    externalPlaceholderOpacities.delete(element)
  }
  const setExternalPlaceholder = (object: HTMLElement, enabled: boolean) => {
    if (!enabled) {
      for (const element of [...externalPlaceholderOpacities.keys()]) {
        restoreExternalPlaceholder(element)
      }
      return
    }

    const desired = new Set(externalPlaceholderElements(object))
    for (const element of [...externalPlaceholderOpacities.keys()]) {
      if (!desired.has(element)) restoreExternalPlaceholder(element)
    }
    for (const element of desired) {
      if (!externalPlaceholderOpacities.has(element)) {
        externalPlaceholderOpacities.set(element, {
          value: element.style.getPropertyValue('opacity'),
          priority: element.style.getPropertyPriority('opacity'),
          computed: Number(target.getComputedStyle(element).opacity),
        })
      }
      if (element.style.getPropertyValue('opacity') !== '0' ||
          element.style.getPropertyPriority('opacity') !== 'important') {
        element.style.setProperty('opacity', '0', 'important')
      }
    }
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
    const objectRect = resolveBroadcastMediaSlot(object).rect
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
      // A background cleared by this runtime is now computed as transparent.
      // Keep tracking it while it still covers the media slot; otherwise the
      // next observer pass would restore it, then clear it again forever.
      if (!externalBackgrounds.has(element) &&
          (style.backgroundColor === 'rgba(0, 0, 0, 0)' ||
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
    // Sample the receiver background on the first animation frame after the
    // document is ready.  Several broadcast applications select their 4K/8K
    // theme from a DOM-ready callback; sampling in the same microtask as
    // DOMContentLoaded captures the transient default (commonly white).
    // This must also run before setExternalMediaHole() clears application
    // backgrounds for the external video plane.
    if (!stageStyleReported && target.document.readyState !== 'loading') {
      reportStageStyle()
      stageStyleReported = true
    }
    const object = applicationBoundary.permits(
      target.location.href,
      ARIB_PERMISSION_BITS.broadcastMedia,
    )
      ? target.document.querySelector<HTMLElement>(
          'object[type="video/x-arib2-broadcast"], ' +
          'object[data-arib-type="video/x-arib2-broadcast"]',
        )
      : null
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
    const slot = resolveBroadcastMediaSlot(object)
    const rect = slot.rect
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
        externalPlacement: slot.element !== object &&
          Number.parseInt(target.getComputedStyle(slot.element).zIndex, 10) > 0
          ? 'above-application'
          : 'behind-application',
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
    // Static broadcast objects must have their receiver API before later
    // DOMContentLoaded/ready listeners call isCaptionExistent().  Stage
    // sampling is intentionally left to the scheduled animation-frame report
    // below, after application ready callbacks have selected their theme.
    const object = applicationBoundary.permits(
      target.location.href,
      ARIB_PERMISSION_BITS.broadcastMedia,
    )
      ? target.document.querySelector<HTMLElement>(
          'object[type="video/x-arib2-broadcast"], ' +
          'object[data-arib-type="video/x-arib2-broadcast"]',
        )
      : null
    if (object) installBroadcastObjectApi(object as BroadcastObject)
    prepareExternalMediaPlaneCanvas()
    scheduleMediaPlaneReport()
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
