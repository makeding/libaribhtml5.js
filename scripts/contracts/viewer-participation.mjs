import assert from 'node:assert/strict'

import { ViewerParticipationController } from '../../src/viewer-participation.ts'

const participationNotification = {
  contextId: 10,
  sourcePacketId: 0x8000,
  eventMessageTag: 0xff,
  dataEventId: 0x0f,
  messageGroupId: 0x0f00,
  version: 3,
  currentNext: true,
  sectionNumber: 0,
  lastSectionNumber: 0,
  inputOffset: 123n,
}
const participation = new ViewerParticipationController()
assert.equal(participation.notify(participationNotification)?.requiresUserAction, true)
assert.equal(participation.notify(participationNotification), null)
participation.resetSession()
participation.setPresentation({ inputActive: true })
assert.equal(participation.notify(participationNotification), null)
participation.setPresentation({ inputActive: false })
assert.equal(participation.notify(participationNotification)?.version, 3)
participation.setPresentation({ visible: true, inputActive: true })
assert.equal(participation.notify({ ...participationNotification, version: 4 }), null)
participation.setPresentation({ visible: false })
assert.equal(participation.notify({ ...participationNotification, version: 4 })?.version, 4)
assert.equal(participation.notify({ ...participationNotification, version: 5, currentNext: false }), null)
