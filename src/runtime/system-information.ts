import packageMetadata from '../../package.json' with { type: 'json' }

export type ReceiverSystemIdentity = {
  browsername: string
  browserversion: string
  makerid: string
  modelname: string
}

export type ReceiverSystemInformation = ReceiverSystemIdentity & {
  baseurl: string
  [key: string]: unknown
}

/** Additional receiver-owned fields. baseurl is always derived from the VFS mount. */
export type ReceiverSystemInformationOverrides = Partial<ReceiverSystemIdentity> &
  Record<string, unknown>

const RECEIVER_INFORMATION_FIELDS = new Set(['zipcode', 'prefecture', 'regioncode'])

export const RECEIVER_SYSTEM_IDENTITY: Readonly<ReceiverSystemIdentity> = Object.freeze({
  browsername: packageMetadata.name,
  browserversion: packageMetadata.version,
  makerid: packageMetadata.author.name,
  modelname: packageMetadata.aribReceiver.modelName,
})

export function createReceiverSystemInformation(
  baseurl: string,
  overrides: ReceiverSystemInformationOverrides = {},
): ReceiverSystemInformation {
  return {
    ...RECEIVER_SYSTEM_IDENTITY,
    ...overrides,
    baseurl,
  }
}

/**
 * Project receiver-owned regional settings into the legacy receiverinfo Ureg.
 * The host remains the sole owner of persistence; broadcast applications only
 * receive the snapshot supplied in systemInformation.
 */
export function readReceiverInformationArray(
  namespace: string,
  structure: string,
  systemInformation: ReceiverSystemInformation,
): unknown[] | null {
  if (!namespace.toLowerCase().includes('receiverinfo')) return null
  return structure.split(',').map((field) => {
    const key = field.trim().toLowerCase()
    return RECEIVER_INFORMATION_FIELDS.has(key) ? systemInformation[key] ?? null : null
  })
}
