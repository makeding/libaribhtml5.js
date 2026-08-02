/**
 * Convert the ARIB STD-B60 24-bit LCT background colour to a CSS colour.
 * A null value removes the current LCT override and restores host fallback
 * selection.
 */
export function normalizeLctBackgroundColor(value: number | null): string | null {
  if (value === null) return null
  if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
    throw new RangeError('LCT backgroundColorRgb must be a 24-bit integer or null')
  }
  return `#${value.toString(16).padStart(6, '0')}`
}

export function resolveReceiverBackgroundColor(
  lctColor: string | null,
  stageColor: string | null,
): string {
  return lctColor ?? stageColor ?? '#000'
}
