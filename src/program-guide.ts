import { cloneProgramInfo, type ProgramInfo } from './program-info.ts'

export type AribProgramGuideRequest = {
  /**
   * Open the receiver's full program guide, or focus a particular program.
   * Android/WebView hosts normally map `program-detail` to their native EPG UI.
   */
  destination: 'program-guide' | 'program-detail'
  /** Program identity and metadata supplied by the player/EPG search result. */
  program?: ProgramInfo
  /** Presentation state used by the host; Android distinguishes live and future results. */
  state?: 'current' | 'future'
}

export type AribProgramGuideHandler = (
  request: AribProgramGuideRequest,
) => boolean | void | Promise<boolean | void>

export type AribProgramGuideUnavailableReason = 'unsupported' | 'rejected' | 'error'

export type AribProgramGuideUnavailableEvent = {
  request: AribProgramGuideRequest
  reason: AribProgramGuideUnavailableReason
  error?: unknown
}

export type AribProgramGuideUnavailableHandler = (
  event: AribProgramGuideUnavailableEvent,
) => void

function copyRequest(request: AribProgramGuideRequest): AribProgramGuideRequest {
  return {
    ...request,
    program: request.program ? cloneProgramInfo(request.program) : undefined,
  }
}

/**
 * Dispatch a receiver-owned EPG transition without coupling the SDK to a
 * particular Android activity, WebView bridge, or browser player UI.
 */
export async function dispatchProgramGuideRequest(
  request: AribProgramGuideRequest,
  handler?: AribProgramGuideHandler,
  unavailable?: AribProgramGuideUnavailableHandler,
): Promise<boolean> {
  const copied = copyRequest(request)
  if (!handler) {
    unavailable?.({ request: copied, reason: 'unsupported' })
    return false
  }

  try {
    const accepted = await handler(copied)
    if (accepted === false) {
      unavailable?.({ request: copied, reason: 'rejected' })
      return false
    }
    return true
  } catch (error) {
    unavailable?.({ request: copied, reason: 'error', error })
    return false
  }
}
