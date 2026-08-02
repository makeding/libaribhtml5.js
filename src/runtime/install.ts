import { installRomSoundProtocol } from './romsound.ts'
import { installAribSymbolFont } from './fonts'
import { installBroadcastClock, type BroadcastNowProvider } from './clock'
import type { AribMediaPlaneAdapter } from '../media-plane'
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
  type AribPermissionBit,
  type RuntimePermissionManagedArea,
} from './application-boundary'
import { installExternalNetworkPolicy } from './external-network'
import { RuntimeMediaPlaneController } from './media-plane-runtime'
import { RuntimeCaptionController } from './caption-controller'
import {
  RuntimeApplicationController,
  type RuntimeApplicationInformation,
} from './application-controller'

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
export type { RuntimeApplicationInformation } from './application-controller'

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
  const applicationController = new RuntimeApplicationController({
    target,
    broadcastBaseUrl,
    resolveRuntimeUrl,
    allowExternalNetwork: options.allowExternalNetwork ?? false,
    application: options.application,
    postRuntime,
  })
  const requirePermission = (bit: AribPermissionBit): void => {
    applicationController.requirePermission(bit)
  }

  installExternalNetworkPolicy(target, options.allowExternalNetwork)

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
  const captionController = new RuntimeCaptionController({
    requirePermission: () => requirePermission(ARIB_PERMISSION_BITS.broadcastMedia),
    postRuntime,
  })

  let mediaPlaneRuntime: RuntimeMediaPlaneController
  target.addEventListener('message', (event) => {
    if (event.source !== target.parent || event.origin !== target.location.origin) return
    if (event.data?.type !== 'arib-host' || event.data.runtimeId !== runtimeId) return
    if (captionController.handleHostMessage(event.data)) return
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
        const withinBoundary = applicationController.updateApplicationInformation(
          event.data.value ?? {},
        )
        mediaPlaneRuntime.schedule()
        if (!withinBoundary) {
          postRuntime('application-boundary-exit', { url: target.location.href })
        }
      } catch (error) {
        postRuntime('error', { message: `Invalid application information: ${String(error)}` })
      }
      return
    }
    if (event.data.event === 'receiver-input-state') {
      applicationController.setHostInputActive(Boolean(event.data.active))
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

  mediaPlaneRuntime = new RuntimeMediaPlaneController({
    target,
    adapter: options.mediaPlaneAdapter,
    canUseBroadcastMedia: () => applicationController.permits(
      ARIB_PERMISSION_BITS.broadcastMedia,
    ),
    installBroadcastObjectApi: captionController.installBroadcastObjectApi,
    postRuntime,
  })

  const startDocumentRuntime = () => {
    applicationController.startDocument()
    // Static objects need their receiver API before application ready listeners run.
    // Stage sampling remains deferred to the controller's first animation frame.
    mediaPlaneRuntime.startDocument()
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
  applicationController.startNavigationCapture()
  mediaPlaneRuntime.startObserving()

  target.addEventListener('pagehide', () => {
    mediaPlaneRuntime.dispose('document-unload', () => resourceCache.dispose())
    applicationController.dispose()
    postRuntime('unloading', { url: target.location.href })
  })

  target.addEventListener('error', (event) => {
    postRuntime('error', {
      message: event.message,
    })
  })
}
