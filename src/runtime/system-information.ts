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
