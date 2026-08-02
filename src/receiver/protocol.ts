import type { AribMediaPlane, AribMediaPlaneLayer } from '../media-plane'

/** Untrusted runtime-to-host wire message before session and event filtering. */
export type RuntimeMessage = Record<string, unknown> & {
  type?: string
  runtimeId?: string
  event?: string
}

export type AribApplicationReplaceRequest = {
  organizationId: number
  applicationId: number
  aitUrl: string | null
}

export type ReceiverMediaPlaneFallback = {
  screenWidth: number
  screenHeight: number
}

export function normalizeStageBackgroundColor(value: unknown): string | null {
  const color = String(value ?? '')
  return color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent'
    ? color
    : null
}

export function normalizeCaptionSubscriptionTags(value: unknown): number[] {
  return Array.isArray(value)
    ? [...new Set(value
        .map(Number)
        .filter(componentTag => Number.isInteger(componentTag) &&
          componentTag >= 0 && componentTag <= 0xffff))]
    : []
}

export function normalizeApplicationReplaceRequest(
  message: RuntimeMessage,
): AribApplicationReplaceRequest | null {
  const organizationId = Number(message.organizationId)
  const applicationId = Number(message.applicationId)
  const request: AribApplicationReplaceRequest = {
    organizationId,
    applicationId,
    aitUrl: message.aitUrl === null || message.aitUrl === undefined
      ? null
      : String(message.aitUrl),
  }
  if (!Number.isSafeInteger(organizationId) || organizationId < 0 ||
      !Number.isSafeInteger(applicationId) || applicationId < 0) {
    return null
  }
  return request
}

export function normalizeMediaLayer(value: unknown): AribMediaPlaneLayer {
  if (!value || typeof value !== 'object') {
    return { documentOrder: -1, stackingPath: [] }
  }
  const layer = value as Partial<AribMediaPlaneLayer>
  return {
    documentOrder: Number(layer.documentOrder) || 0,
    stackingPath: Array.isArray(layer.stackingPath) ? layer.stackingPath : [],
    externalPlacement: layer.externalPlacement === 'above-application'
      ? 'above-application'
      : 'behind-application',
  }
}

export function normalizeMediaPlane(
  message: RuntimeMessage,
  fallback: ReceiverMediaPlaneFallback,
): AribMediaPlane {
  if (!message.visible) {
    return {
      slotId: String(message.slotId ?? ''),
      visible: false,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      screenWidth: fallback.screenWidth,
      screenHeight: fallback.screenHeight,
      layer: normalizeMediaLayer(message.layer),
    }
  }
  return {
    slotId: String(message.slotId ?? ''),
    visible: true,
    x: Number(message.x) || 0,
    y: Number(message.y) || 0,
    width: Number(message.width) || 0,
    height: Number(message.height) || 0,
    screenWidth: Number(message.screenWidth) || 3840,
    screenHeight: Number(message.screenHeight) || 2160,
    videoSource: typeof message.videoSource === 'string' ? message.videoSource : undefined,
    audioSource: typeof message.audioSource === 'string' ? message.audioSource : undefined,
    layer: normalizeMediaLayer(message.layer),
  }
}
