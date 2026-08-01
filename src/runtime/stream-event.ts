export type RuntimeEventSource = {
  original_network_id?: number
  tlv_stream_id?: number
  service_id?: number
  event_message_tag: number
}

export type RuntimeEvent = {
  source: RuntimeEventSource
  message_group_id: number
  message_id: number
  message_version: number
  private_data_byte: string
}

export type RuntimeEventSelector = {
  source?: Partial<RuntimeEventSource>
  message_group_id?: number
  message_id?: number
  message_version?: number
}

export function runtimeEventMatchesSelector(
  event: RuntimeEvent,
  selector: RuntimeEventSelector,
): boolean {
  const source = selector.source
  if (source) {
    for (const key of [
      'original_network_id',
      'tlv_stream_id',
      'service_id',
      'event_message_tag',
    ] as const) {
      if (source[key] !== undefined && source[key] !== event.source[key]) return false
    }
  }
  if (selector.message_group_id !== undefined &&
      selector.message_group_id !== event.message_group_id) return false
  if (selector.message_id === undefined) return true
  if (selector.message_id !== event.message_id) return false
  return selector.message_version === undefined ||
    selector.message_version === event.message_version
}

export function sameRuntimeEventSelector(
  first: RuntimeEventSelector,
  second: RuntimeEventSelector,
): boolean {
  const sourceKeys = [
    'original_network_id',
    'tlv_stream_id',
    'service_id',
    'event_message_tag',
  ] as const
  return sourceKeys.every(key => first.source?.[key] === second.source?.[key]) &&
    first.message_group_id === second.message_group_id &&
    first.message_id === second.message_id &&
    first.message_version === second.message_version
}
