import {
  ARIB_PERMISSION_BITS,
  AribApplicationBoundaryPolicy,
  type AribPermissionManagedArea,
  type AribPermissionBit,
  type RuntimePermissionManagedArea,
} from './application-boundary'

type RuntimeWindow = Window & typeof globalThis & Record<string, unknown>

export type RuntimeApplicationInformation = {
  type?: string
  organizationId?: number
  applicationId?: number
  controlCode?: string
  autostartPriority?: number
  /** Decoded loops from MH-AIT descriptor 0x802C. Omit when absent. */
  permissionManagedAreas?: readonly RuntimePermissionManagedArea[]
}

type RuntimeApplicationControllerOptions = {
  target: RuntimeWindow
  broadcastBaseUrl: string | URL
  resolveRuntimeUrl: (value: unknown) => URL
  allowExternalNetwork: boolean
  application?: RuntimeApplicationInformation
  postRuntime: (event: string, detail?: Record<string, unknown>) => void
}

/** Owns the application-manager, permission-boundary, and navigation state. */
export class RuntimeApplicationController {
  private readonly target: RuntimeWindow
  private readonly resolveRuntimeUrl: (value: unknown) => URL
  private readonly allowExternalNetwork: boolean
  private readonly postRuntime: (
    event: string,
    detail?: Record<string, unknown>,
  ) => void
  private readonly boundary: AribApplicationBoundaryPolicy

  private applicationInformation: RuntimeApplicationInformation
  private applicationVisible = true
  private applicationInputActive = false
  private navigationCaptureInstalled = false

  private readonly keySet = {
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

  private readonly boundaryDescriptor = {
    getCurrentBoundary: () => {
      this.requirePermission(ARIB_PERMISSION_BITS.broadcastResources)
      return this.boundary.getCurrentBoundary()
    },
    addPermissionManagedArea: (area: AribPermissionManagedArea) => {
      this.requirePermission(ARIB_PERMISSION_BITS.boundaryExtension)
      this.boundary.addPermissionManagedArea(area)
    },
  }

  private readonly ownerApplication: Record<string, unknown>

  constructor(options: RuntimeApplicationControllerOptions) {
    this.target = options.target
    this.resolveRuntimeUrl = options.resolveRuntimeUrl
    this.allowExternalNetwork = options.allowExternalNetwork
    this.postRuntime = options.postRuntime
    this.applicationInformation = { ...options.application }
    this.boundary = new AribApplicationBoundaryPolicy(
      options.broadcastBaseUrl,
      this.target.location.href,
      this.applicationInformation.permissionManagedAreas,
    )
    this.ownerApplication = {
      type: this.applicationInformation.type ?? '',
      organization_id: this.applicationInformation.organizationId ?? 0,
      application_id: this.applicationInformation.applicationId ?? 0,
      control_code: this.applicationInformation.controlCode ?? '',
      autostart_priority: this.applicationInformation.autostartPriority ?? 0,
      keySet: this.keySet,
      show: () => {
        this.applicationVisible = true
        this.applyApplicationVisibility()
        this.reportApplicationPresentation()
        return true
      },
      hide: () => {
        this.applicationVisible = false
        this.applyApplicationVisibility()
        this.reportApplicationPresentation()
        return true
      },
      activateInput: () => {
        this.applicationInputActive = true
        this.reportApplicationPresentation()
        return true
      },
      deactivateInput: () => {
        this.applicationInputActive = false
        this.reportApplicationPresentation()
        return true
      },
      createApplication: (url: string) => {
        const resolved = this.allowedNavigationUrl(url)
        if (!resolved) {
          this.reportBlockedNavigation(url)
          return null
        }
        this.target.location.href = resolved.href
        return this.ownerApplication
      },
      destroyApplication: () => {
        this.postRuntime('destroy')
      },
      replaceApplication: (
        organizationId: number,
        applicationId: number,
        aitUrl: string | null = null,
      ) => {
        this.requirePermission(ARIB_PERMISSION_BITS.broadcastResources)
        if (!Number.isSafeInteger(organizationId) || organizationId < 0 ||
            !Number.isSafeInteger(applicationId) || applicationId < 0) {
          this.postRuntime('error', {
            message: 'Invalid replaceApplication application identifier',
          })
          return
        }
        this.postRuntime('replace-application', {
          organizationId,
          applicationId,
          aitUrl: aitUrl === null ? null : String(aitUrl),
        })
      },
      exitFromManagedState: (url: string) => {
        this.requirePermission(ARIB_PERMISSION_BITS.broadcastResources)
        this.postRuntime('exit-managed-state', { url: String(url ?? '') })
      },
      getApplicationBoundaryAndPermissionDescriptor: () => {
        this.requirePermission(ARIB_PERMISSION_BITS.broadcastResources)
        return this.boundary.hasDescriptor() ? this.boundaryDescriptor : null
      },
    }

    Object.defineProperty(this.target.navigator, 'applicationManager', {
      configurable: true,
      enumerable: true,
      value: { getOwnerApplication: () => this.ownerApplication },
    })
  }

  requirePermission(bit: AribPermissionBit): void {
    if (this.permits(bit)) return
    const error = new Error('Not authorized') as Error & { code?: string }
    error.name = 'Error'
    error.code = 'NOT_AUTHORIZED_ERR'
    throw error
  }

  permits(bit: AribPermissionBit): boolean {
    return this.boundary.permits(this.target.location.href, bit)
  }

  updateApplicationInformation(value: RuntimeApplicationInformation): boolean {
    const next = { ...value }
    this.boundary.update(next.permissionManagedAreas)
    this.applicationInformation = next
    this.ownerApplication.type = next.type ?? ''
    this.ownerApplication.organization_id = next.organizationId ?? 0
    this.ownerApplication.application_id = next.applicationId ?? 0
    this.ownerApplication.control_code = next.controlCode ?? ''
    this.ownerApplication.autostart_priority = next.autostartPriority ?? 0
    return this.boundary.evaluate(this.target.location.href).withinBoundary
  }

  setHostInputActive(active: boolean): void {
    this.applicationInputActive = Boolean(active)
  }

  startDocument(): void {
    const nhksh = this.target.nhksh as Record<string, unknown> | undefined
    if (!nhksh || typeof nhksh.lu !== 'function' || nhksh.__navigationGuarded) return
    const navigate = nhksh.lu as (url: string, ...args: unknown[]) => unknown
    nhksh.lu = (url: string, ...args: unknown[]) => {
      const resolved = this.allowedNavigationUrl(url)
      if (!resolved) {
        this.reportBlockedNavigation(url)
        return false
      }
      return navigate.call(nhksh, resolved.href, ...args)
    }
    nhksh.__navigationGuarded = true
  }

  startNavigationCapture(): void {
    if (this.navigationCaptureInstalled) return
    this.navigationCaptureInstalled = true
    this.target.document.addEventListener('click', this.handleDocumentClick, true)
  }

  dispose(): void {
    if (!this.navigationCaptureInstalled) return
    this.navigationCaptureInstalled = false
    this.target.document.removeEventListener('click', this.handleDocumentClick, true)
  }

  private applyApplicationVisibility(): void {
    this.target.document.documentElement.style.setProperty(
      'visibility',
      this.applicationVisible ? 'visible' : 'hidden',
      'important',
    )
  }

  private reportApplicationPresentation(): void {
    this.postRuntime('application-presentation', {
      visible: this.applicationVisible,
      inputActive: this.applicationInputActive,
    })
  }

  private reportBlockedNavigation(value: unknown): void {
    let url = String(value ?? '')
    try {
      url = new URL(url, this.target.location.href).href
    } catch {
      // Keep the original value for diagnostics.
    }
    this.postRuntime('navigation-blocked', { url })
  }

  private allowedNavigationUrl(value: unknown): URL | null {
    try {
      const url = this.resolveRuntimeUrl(value)
      if (!/^https?:$/.test(url.protocol)) return null
      if (url.origin !== this.target.location.origin && !this.allowExternalNetwork) return null
      return this.boundary.evaluate(url).withinBoundary ? url : null
    } catch {
      return null
    }
  }

  private readonly handleDocumentClick = (event: Event): void => {
    const element = event.target instanceof this.target.Element ? event.target : null
    const anchor = element?.closest<HTMLAnchorElement>('a[href]')
    if (!anchor) return
    const resolved = this.allowedNavigationUrl(anchor.href)
    if (resolved && resolved.href === anchor.href) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (resolved) this.target.location.href = resolved.href
    else this.reportBlockedNavigation(anchor.href)
  }
}
