import type { ReceiverDeviceIdentifierProvider } from '../device-identifier'
import type { AribMediaPlane, AribMediaPlaneAdapter } from '../media-plane'
import type {
  AribProgramGuideHandler,
  AribProgramGuideUnavailableHandler,
} from '../program-guide'
import type { RuntimeApplicationInformation } from '../runtime/install'
import type { BroadcastResourceStore } from '../runtime/resources'
import type { ReceiverSystemInformationOverrides } from '../runtime/system-information'
import type { AribViewerParticipationEvent } from '../viewer-participation'
import type { AribApplicationReplaceRequest } from './protocol'

export type AribCaptionPacket = {
  componentTag: number
  payload?: string
  dataType?: string
  tmd?: string
  data?: string
}

export type AribCaptionSubscription = {
  componentTags: number[]
}

export type AribApplicationInformation = RuntimeApplicationInformation

export type { AribApplicationReplaceRequest } from './protocol'

export type AribApplicationReplaceHandler = (
  request: AribApplicationReplaceRequest,
) => void | Promise<void>

export type AribExitManagedStateHandler = (url: string) => void | Promise<void>

export type AribBroadcastClock = {
  /** Absolute broadcast time at the anchor, as Unix epoch milliseconds. */
  epochMilliseconds: number
  /** Media timeline value which corresponds to epochMilliseconds. */
  mediaTimeSeconds?: number
  /** Current playback position; enables pause, rate, and seek aware projection. */
  currentMediaTimeSeconds?: () => number
}

export type AribReceiverLifecycleEvent =
  | { type: 'loading'; url: string }
  | { type: 'installed'; url: string; runtimeId: string }
  | { type: 'navigating'; url: string }
  | { type: 'exited' }
  | { type: 'navigation-blocked'; url: string }
  | { type: 'frame-blocked'; url: string }
  | { type: 'error'; message: string }

export type AribReceiverHostOptions = {
  iframe: HTMLIFrameElement
  viewport: HTMLElement
  /** Surface used only by the behind-iframe compatibility adapter. */
  videoSurface?: HTMLElement
  mediaPlaneAdapter?: AribMediaPlaneAdapter
  onStatus?: (status: string) => void
  /** Machine-readable application/runtime lifecycle; never branch on onStatus text. */
  onLifecycle?: (event: AribReceiverLifecycleEvent) => void
  /** Time to wait for a loaded document to install the receiver runtime. 0 disables the fallback. */
  applicationLoadTimeoutMs?: number
  onUrlChange?: (url: string) => void
  onMediaPlane?: (plane: AribMediaPlane) => void
  /** @deprecated Use onMediaPlane. */
  onVideoPlane?: (plane: AribMediaPlane) => void
  keepVideoVisible?: boolean
  /** Allow broadcaster applications to use HTTP origins outside this host. */
  allowExternalNetwork?: boolean
  /** Same-origin namespace where a Worker or HTTP server exposes carousel data. */
  broadcastBaseUrl?: string | URL
  /** Optional bridge to a Service Worker, Cache Storage, or carousel VFS. */
  resourceStore?: BroadcastResourceStore
  /** Receiver/WebView bridge which opens the native EPG or a program detail page. */
  onOpenProgramGuide?: AribProgramGuideHandler
  /** Active caption components requested by the current broadcast document. */
  onCaptionSubscription?: (subscription: AribCaptionSubscription) => void
  /** Resolve Application.replaceApplication() through the receiver's current MH-AIT. */
  onReplaceApplication?: AribApplicationReplaceHandler
  /** Transfer an application to an unmanaged general-application URL. */
  onExitManagedState?: AribExitManagedStateHandler
  /** Override the default browser alert when the receiver cannot open the EPG. */
  onProgramGuideUnavailable?: AribProgramGuideUnavailableHandler
  /** Receiver identity/capabilities exposed to the broadcast application. */
  systemInformation?: ReceiverSystemInformationOverrides
  /** Resolve receiver/CAS identifiers; defaults to the bundled Huggy demo identity. */
  getDeviceIdentifier?: ReceiverDeviceIdentifierProvider
  /** Receiver UI hook for a TR-B39 viewer-participation corner notification. */
  onViewerParticipation?: (event: AribViewerParticipationEvent) => void
}
