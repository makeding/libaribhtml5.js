import assert from 'node:assert/strict'

import { dispatchProgramGuideRequest } from '../../src/program-guide.ts'

const guideRequest = {
  destination: 'program-detail',
  state: 'future',
  program: { service_id: 101, event_id: 42 },
}
const guideUnavailable = []
assert.equal(await dispatchProgramGuideRequest(
  guideRequest,
  undefined,
  event => guideUnavailable.push(event),
), false)
assert.equal(guideUnavailable[0].reason, 'unsupported')

let openedGuide
assert.equal(await dispatchProgramGuideRequest(guideRequest, request => {
  openedGuide = request
  request.program.event_id = 99
}), true)
assert.equal(openedGuide.state, 'future')
assert.equal(guideRequest.program.event_id, 42)

assert.equal(await dispatchProgramGuideRequest(
  guideRequest,
  () => false,
  event => guideUnavailable.push(event),
), false)
assert.equal(guideUnavailable.at(-1).reason, 'rejected')

assert.equal(await dispatchProgramGuideRequest(
  guideRequest,
  () => { throw new Error('native bridge unavailable') },
  event => guideUnavailable.push(event),
), false)
assert.equal(guideUnavailable.at(-1).reason, 'error')
