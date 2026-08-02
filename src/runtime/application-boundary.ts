export const ARIB_PERMISSION_BITS = {
  broadcastMedia: 12,
  monomediaOverBroadcastVideo: 11,
  currentEventInformation: 10,
  persistentStorage: 9,
  boundaryExtension: 8,
  deviceIdentifier: 7,
  ipNetworkConfirmation: 6,
  broadcastResources: 5,
  scheduling: 4,
  cas: 3,
} as const

export type AribPermissionBit =
  typeof ARIB_PERMISSION_BITS[keyof typeof ARIB_PERMISSION_BITS]

/** One loop of the MH-application boundary and permission descriptor. */
export type RuntimePermissionManagedArea = {
  /** Raw 16-bit permission_bitmap values, including the three-bit bitmap id. */
  permissionBitmaps: readonly number[] | null
  /** managed_URL values. null or an empty array means all locations. */
  managedUrls: readonly string[] | null
}

/** Shape exposed by ApplicationBoundaryAndPermissionDescriptor in ARIB STD-B62. */
export type AribPermissionManagedArea = {
  /** Raw 16-bit permission_bitmap values, or null for maximum permission. */
  permission: number[] | null
  /** Managed URL strings, or null for all locations. */
  urls: string[] | null
}

export type AribPermissionEvaluation = {
  withinBoundary: boolean
  permissionBits: number
}

const LOWER_PERMISSION_BITS = 0x1fff
const MAX_PERMISSION_BITMAPS = 16
const MAX_MANAGED_URLS = 160

function invalidParameter(message: string): TypeError {
  const error = new TypeError(message) as TypeError & { code?: string }
  error.code = 'INVALID_PARAM_ERR'
  return error
}

function cloneArea(area: RuntimePermissionManagedArea): RuntimePermissionManagedArea {
  const permissionBitmaps = area.permissionBitmaps === null
    ? null
    : [...area.permissionBitmaps]
  const managedUrls = area.managedUrls === null ? null : [...area.managedUrls]
  return { permissionBitmaps, managedUrls }
}

function normalizeArea(area: RuntimePermissionManagedArea): RuntimePermissionManagedArea {
  if (!area || typeof area !== 'object') {
    throw invalidParameter('Permission managed area must be an object')
  }
  const candidate = area as RuntimePermissionManagedArea & Record<string, unknown>
  if (candidate.permissionBitmaps !== null && !Array.isArray(candidate.permissionBitmaps)) {
    throw invalidParameter('permissionBitmaps must be an array or null')
  }
  if (candidate.managedUrls !== null && !Array.isArray(candidate.managedUrls)) {
    throw invalidParameter('managedUrls must be an array or null')
  }
  const permissionBitmaps = candidate.permissionBitmaps === null
    ? null
    : [...candidate.permissionBitmaps]
  const managedUrls = candidate.managedUrls === null ? null : [...candidate.managedUrls]
  for (const bitmap of permissionBitmaps ?? []) {
    if (!Number.isInteger(bitmap) || bitmap < 0 || bitmap > 0xffff) {
      throw invalidParameter('permission_bitmap must be a 16-bit integer')
    }
  }
  for (const url of managedUrls ?? []) {
    if (typeof url !== 'string' || new TextEncoder().encode(url).length > 255) {
      throw invalidParameter('managed_URL must be a string')
    }
  }
  return { permissionBitmaps, managedUrls }
}

function assertReceiverCapacity(areas: readonly RuntimePermissionManagedArea[]): void {
  const bitmapCount = areas.reduce(
    (count, area) => count + (area.permissionBitmaps?.length ?? 0),
    0,
  )
  const urlCount = areas.reduce(
    (count, area) => count + (area.managedUrls?.length ?? 0),
    0,
  )
  if (bitmapCount > MAX_PERMISSION_BITMAPS) {
    throw invalidParameter(`At most ${MAX_PERMISSION_BITMAPS} permission bitmaps are supported`)
  }
  if (urlCount > MAX_MANAGED_URLS) {
    throw invalidParameter(`At most ${MAX_MANAGED_URLS} managed URLs are supported`)
  }
}

function permissionBits(bitmaps: readonly number[] | null): number {
  if (bitmaps === null || bitmaps.length === 0) return LOWER_PERMISSION_BITS

  // Bitmap 1 is the current per-function representation. Bitmap 0 is its
  // all-or-nothing compatibility form and is used only when bitmap 1 is absent.
  const bitmap1 = bitmaps.find(bitmap => bitmap >>> 13 === 1)
  if (bitmap1 !== undefined) return bitmap1 & LOWER_PERMISSION_BITS
  const bitmap0 = bitmaps.find(bitmap => bitmap >>> 13 === 0)
  if (bitmap0 === undefined) return 0
  const bits = bitmap0 & LOWER_PERMISSION_BITS
  return bits === 0 || bits === LOWER_PERMISSION_BITS ? bits : 0
}

function isBroadcastResource(url: URL, broadcastBaseUrl: URL): boolean {
  return url.origin === broadcastBaseUrl.origin &&
    url.pathname.startsWith(broadcastBaseUrl.pathname)
}

function managedUrlSpecificity(
  value: string,
  candidate: URL,
  documentUrl: URL,
): number | null {
  let managed: URL
  try {
    managed = new URL(value, documentUrl)
  } catch {
    return null
  }
  if (!/^https?:$/.test(managed.protocol) || managed.origin !== candidate.origin) return null

  const managedPath = managed.pathname.replace(/\/+$/, '') || '/'
  const candidatePath = candidate.pathname
  if (managedPath !== '/' &&
      candidatePath !== managedPath &&
      !candidatePath.startsWith(`${managedPath}/`)) return null

  // Any explicit domain is narrower than the all-location area. Within one
  // domain a longer sub-directory is the narrower permission setting.
  return managed.origin.length + managedPath.length
}

export class AribApplicationBoundaryPolicy {
  private readonly broadcastBaseUrl: URL
  private readonly documentUrl: URL
  private baseAreas: RuntimePermissionManagedArea[] | undefined
  private readonly addedAreas: RuntimePermissionManagedArea[] = []

  constructor(
    broadcastBaseUrl: string | URL,
    documentUrl: string | URL,
    areas?: readonly RuntimePermissionManagedArea[],
  ) {
    this.broadcastBaseUrl = new URL(broadcastBaseUrl)
    if (!this.broadcastBaseUrl.pathname.endsWith('/')) this.broadcastBaseUrl.pathname += '/'
    this.documentUrl = new URL(documentUrl)
    this.update(areas)
  }

  /** Apply a new MH-AIT descriptor without discarding areas added by the application. */
  update(areas?: readonly RuntimePermissionManagedArea[]): void {
    const normalized = areas?.map(normalizeArea)
    assertReceiverCapacity([...(normalized ?? []), ...this.addedAreas])
    this.baseAreas = normalized
  }

  hasDescriptor(): boolean {
    return this.baseAreas !== undefined || this.addedAreas.length > 0
  }

  getCurrentBoundary(): AribPermissionManagedArea[] {
    return [...(this.baseAreas ?? []), ...this.addedAreas].map(area => ({
      permission: area.permissionBitmaps === null || area.permissionBitmaps.length === 0
        ? null
        : [...area.permissionBitmaps],
      urls: area.managedUrls === null || area.managedUrls.length === 0
        ? null
        : [...area.managedUrls],
    }))
  }

  addPermissionManagedArea(area: AribPermissionManagedArea): void {
    if (!area || typeof area !== 'object') {
      throw invalidParameter('Permission managed area must be an object')
    }
    const candidate = area as AribPermissionManagedArea & Record<string, unknown>
    if (candidate.permission !== null && !Array.isArray(candidate.permission)) {
      throw invalidParameter('permission must be an array or null')
    }
    if (candidate.urls !== null && !Array.isArray(candidate.urls)) {
      throw invalidParameter('urls must be an array or null')
    }
    const normalized = normalizeArea({
      permissionBitmaps: candidate.permission === null || candidate.permission.length === 0
        ? null
        : candidate.permission,
      managedUrls: candidate.urls === null || candidate.urls.length === 0 ? null : candidate.urls,
    })
    assertReceiverCapacity([...(this.baseAreas ?? []), ...this.addedAreas, normalized])
    this.addedAreas.push(cloneArea(normalized))
  }

  evaluate(value: string | URL): AribPermissionEvaluation {
    let candidate: URL
    try {
      candidate = new URL(value, this.documentUrl)
    } catch {
      return { withinBoundary: false, permissionBits: 0 }
    }

    // TR-B39 grants broadcast-transmitted data content boundary membership
    // and maximum authority independently of the descriptor.
    if (isBroadcastResource(candidate, this.broadcastBaseUrl)) {
      return { withinBoundary: true, permissionBits: LOWER_PERMISSION_BITS }
    }

    const areas = [...(this.baseAreas ?? []), ...this.addedAreas]
    if (this.baseAreas === undefined && this.addedAreas.length === 0) {
      return { withinBoundary: true, permissionBits: LOWER_PERMISSION_BITS }
    }

    let bestSpecificity = -1
    let bestPermissionBits = 0
    for (const area of areas) {
      const urls = area.managedUrls
      if (urls === null || urls.length === 0) {
        if (bestSpecificity < 0) {
          bestSpecificity = 0
          bestPermissionBits = permissionBits(area.permissionBitmaps)
        } else if (bestSpecificity === 0) {
          bestPermissionBits &= permissionBits(area.permissionBitmaps)
        }
        continue
      }
      for (const url of urls) {
        const specificity = managedUrlSpecificity(url, candidate, this.documentUrl)
        if (specificity === null || specificity < bestSpecificity) continue
        const bits = permissionBits(area.permissionBitmaps)
        if (specificity > bestSpecificity) {
          bestSpecificity = specificity
          bestPermissionBits = bits
        } else {
          // Equal regions are invalid/ambiguous input. Do not let a duplicate
          // region accidentally elevate authority.
          bestPermissionBits &= bits
        }
      }
    }
    return bestSpecificity < 0
      ? { withinBoundary: false, permissionBits: 0 }
      : { withinBoundary: true, permissionBits: bestPermissionBits }
  }

  permits(value: string | URL, bit: AribPermissionBit): boolean {
    const result = this.evaluate(value)
    return result.withinBoundary && (result.permissionBits & (1 << bit)) !== 0
  }
}
