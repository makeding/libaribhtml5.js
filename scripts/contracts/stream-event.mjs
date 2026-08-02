import assert from 'node:assert/strict'

import { runtimeEventMatchesSelector } from '../../src/runtime/stream-event.ts'

const streamEvent = {
  source: {
    original_network_id: 4,
    tlv_stream_id: 11,
    service_id: 101,
    event_message_tag: 50,
  },
  message_group_id: 1,
  message_id: 176,
  message_version: 7,
  private_data_byte: '\u0001\u00ff',
}
assert.equal(runtimeEventMatchesSelector(streamEvent, {
  source: { event_message_tag: 50 },
  message_id: 176,
}), true)
assert.equal(runtimeEventMatchesSelector(streamEvent, {
  source: { original_network_id: 4, tlv_stream_id: 11, service_id: 101 },
  message_group_id: 1,
  message_id: 176,
  message_version: 7,
}), true)
assert.equal(runtimeEventMatchesSelector(streamEvent, {
  source: { event_message_tag: 40 },
  message_id: 176,
}), false)
assert.equal(runtimeEventMatchesSelector(streamEvent, {
  source: { event_message_tag: 50 },
  message_version: 8,
}), true)
