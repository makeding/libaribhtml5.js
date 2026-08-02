/** Current demo receiver identifier (48-bit hexadecimal ACAS source value). */
export const DEFAULT_RECEIVER_DEVICE_IDENTIFIER = '4194c4ae4730'

/** Legacy BML browser.getIRDID() type used for the receiver/CAS identifier. */
export const RECEIVER_IRD_ID_TYPE = 5

export function getDefaultReceiverIrdId(type: number): string | null {
  return type === RECEIVER_IRD_ID_TYPE
    ? DEFAULT_RECEIVER_DEVICE_IDENTIFIER
    : null
}

export type ReceiverDeviceIdentifierProvider = (
  kind: number,
) => string | null | undefined | Promise<string | null | undefined>

export async function resolveReceiverDeviceIdentifier(
  kind: number,
  provider?: ReceiverDeviceIdentifierProvider,
): Promise<string> {
  const value = provider
    ? await provider(kind)
    : DEFAULT_RECEIVER_DEVICE_IDENTIFIER
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string') {
    throw new TypeError('receiver device identifier must be a string')
  }
  return value
}
