export type AribApplicationPresentationState = {
  visible: boolean
  inputActive: boolean
}

export type AribViewerParticipationNotification = {
  contextId: number
  sourcePacketId: number
  eventMessageTag: number
  dataEventId: number
  messageGroupId: number
  version: number
  currentNext: boolean
  sectionNumber: number
  lastSectionNumber: number
  inputOffset: bigint
}

export type AribViewerParticipationEvent = AribViewerParticipationNotification & {
  requiresUserAction: true
}

export class ViewerParticipationController {
  private state: AribApplicationPresentationState = {
    visible: true,
    inputActive: false,
  }
  private generation = 0
  private readonly delivered = new Set<string>()

  get presentation(): AribApplicationPresentationState {
    return { ...this.state }
  }

  setPresentation(state: Partial<AribApplicationPresentationState>): void {
    this.state = {
      visible: state.visible ?? this.state.visible,
      inputActive: state.inputActive ?? this.state.inputActive,
    }
  }

  resetPresentation(): void {
    this.state = { visible: true, inputActive: false }
  }

  resetSession(): void {
    this.generation += 1
    this.delivered.clear()
    this.resetPresentation()
  }

  notify(
    notification: AribViewerParticipationNotification,
  ): AribViewerParticipationEvent | null {
    if (!notification.currentNext || (this.state.visible && this.state.inputActive)) return null
    const key = [
      this.generation,
      notification.contextId,
      notification.sourcePacketId,
      notification.version,
    ].join(':')
    if (this.delivered.has(key)) return null
    this.delivered.add(key)
    return { ...notification, requiresUserAction: true }
  }
}
