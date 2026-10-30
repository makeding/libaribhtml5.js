/** Media identifiers defined by ARIB TR-B39 Table 14-4. */
export type ReceiverMedia = '1' | '2' | '3' | '4' | '6' | '7'
export type ReceiverInputSource = 'onair' | 'recorded'

export type ReceiverCapabilitiesOptions = {
  /** Declare only media supported by the integrating receiver. */
  supportedMedia?: readonly ReceiverMedia[]
  /** Resolve the current input without inferring it from the document URL. */
  getInputSource?: () => ReceiverInputSource | null
}

/** Feature discovery is separate from the application's permission bitmap. */
export function createReceiverCapabilities(options: ReceiverCapabilitiesOptions) {
  const media = new Set(options.supportedMedia ?? [])
  return {
    hasCapability(query: string, ...params: string[]): boolean {
      if (params.length !== 1) return false
      if (query === 'Media') return media.has(params[0] as ReceiverMedia)
      if (query === 'APIGroup') return params[0] === 'sourceIs'
      return false
    },
  }
}

/** TR-B39 sourceIs accepts onair; all other names report false. */
export function receiverSourceIs(options: ReceiverCapabilitiesOptions, name: string): boolean {
  return name === 'onair' && options.getInputSource?.() === 'onair'
}
