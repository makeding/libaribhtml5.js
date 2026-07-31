/**
 * Receiver-owned current/following event information exposed to broadcast apps.
 * Dates are JavaScript Date objects and durations are milliseconds.
 */
export type ProgramInfo = {
  original_network_id?: number
  transport_stream_id?: number
  service_id?: number
  event_id?: number
  name?: string
  event_name?: string
  start_time?: Date
  /** Event duration in milliseconds. */
  duration?: number
  desc?: string
  event_text?: string
  event_extended_text?: string
  running_status?: number
  free_ca_mode?: boolean
  f_event_id?: number
  f_name?: string
  f_start_time?: Date
  /** Following-event duration in milliseconds. */
  f_duration?: number
  f_desc?: string
  [key: string]: unknown
}

const IDENTIFIER_FIELDS = [
  'original_network_id',
  'transport_stream_id',
  'service_id',
  'event_id',
  'f_event_id',
] as const

const DATE_FIELDS = ['start_time', 'f_start_time'] as const
const DURATION_FIELDS = ['duration', 'f_duration'] as const

/** Validate and detach program information before it crosses the host boundary. */
export function cloneProgramInfo(value: ProgramInfo): ProgramInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('program information must be an object')
  }

  const result: ProgramInfo = { ...value }
  for (const field of IDENTIFIER_FIELDS) {
    const item = result[field]
    if (item === undefined) continue
    if (!Number.isInteger(item) || item < 0 || item > 0xffff) {
      throw new TypeError(`${field} must be an unsigned 16-bit integer`)
    }
  }
  for (const field of DATE_FIELDS) {
    const item = result[field]
    if (item === undefined) continue
    const time = Object.prototype.toString.call(item) === '[object Date]'
      ? Number((item as Date).getTime())
      : Number.NaN
    if (!Number.isFinite(time)) {
      throw new TypeError(`${field} must be a valid Date`)
    }
    result[field] = new Date(time)
  }
  for (const field of DURATION_FIELDS) {
    const item = result[field]
    if (item === undefined) continue
    if (!Number.isFinite(item) || item < 0) {
      throw new TypeError(`${field} must be a non-negative millisecond duration`)
    }
  }
  return result
}
