type ClockWindow = Window & typeof globalThis & Record<string, unknown>

export type BroadcastNowProvider = () => number

/** Override only the zero-argument Date paths used for the receiver clock. */
export function installBroadcastClock(
  target: ClockWindow,
  provider?: BroadcastNowProvider,
): void {
  if (!provider || target.__ARIB_HTML5_BROADCAST_CLOCK__) return
  target.__ARIB_HTML5_BROADCAST_CLOCK__ = true

  const NativeDate = target.Date
  const now = (): number => {
    try {
      const value = Number(provider())
      return Number.isFinite(value) ? value : NativeDate.now()
    } catch {
      return NativeDate.now()
    }
  }

  const BroadcastDate = function(this: unknown, ...args: unknown[]) {
    const values = args.length === 0 ? [now()] : args
    if (!new.target) return new NativeDate(now()).toString()
    return Reflect.construct(NativeDate, values, new.target)
  } as unknown as DateConstructor

  Object.setPrototypeOf(BroadcastDate, NativeDate)
  Object.defineProperty(BroadcastDate, 'prototype', {
    value: NativeDate.prototype,
  })
  Object.defineProperty(BroadcastDate, 'now', {
    configurable: true,
    value: now,
  })
  Object.defineProperty(target, 'Date', {
    configurable: true,
    writable: true,
    value: BroadcastDate,
  })
}
