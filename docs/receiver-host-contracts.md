# Receiver host contracts

`libaribhtml5` owns the browser-facing receiver API. Stream and product data
remain owned by the integrating player and are supplied through
`AribReceiverHost`.

## Program information

Pass decoded present/following event information with `host.setProgramInfo()`.
`start_time` and `f_start_time` must be JavaScript `Date` objects; `duration`
and `f_duration` are milliseconds.

```ts
host.setProgramInfo({
  original_network_id: event.originalNetworkId,
  transport_stream_id: event.transportStreamId,
  service_id: event.serviceId,
  event_id: event.eventId,
  event_name: event.title,
  start_time: new Date(event.startTimeUnixMilliseconds),
  duration: event.durationSeconds * 1000,
})
```

Call `host.clearProgramInfo()` before changing input, service, or demux session.
Until the host supplies an event, `receiverDevice.getCurrentEventInformation()`
returns `null`. The SDK does not infer a service or video format from carousel
directory names such as `sh4` or `sh8`.

EIT parsing, present/following selection, AIT context selection, and synthetic
demo metadata belong to the integrating player rather than this SDK.

## System information

Receiver identity and capability fields can be injected when the host is
created. Defaults come from the SDK package metadata.

```ts
const host = new AribReceiverHost({
  iframe,
  viewport,
  systemInformation: {
    makerid: 'receiver-vendor',
    modelname: 'Living Room Receiver',
    decoder: 'native',
  },
})
```

`baseurl` is the stable receiver VFS scope, normally `/data-broadcast/`.
Broadcaster startup libraries may append their selected carousel mount (for
example `sh4`) themselves. The current document mount is used only when mapping
root-relative resources such as `/60/...`; it is not included in `baseurl`.
An injected `baseurl` cannot override the actual VFS scope.

The regional fields `zipcode`, `prefecture`, and `regioncode` are also exposed
read-only through the legacy `receiverinfo` Ureg used by broadcaster apps. The
host owns persistence and passes a snapshot; writes inside the app do not flow
back into the host's settings.

## Receiver capabilities and input source

The SDK owns `navigator.capabilities.hasCapability()` and
`receiverDevice.streamEvent.sourceIs()`. Hosts declare their supported media
using `supportedMedia` (TR-B39 Table 14-4) and provide
`getInputSource: () => 'onair' | 'recorded' | null` from their actual input.
An undeclared source never reports live reception. Only the standard query
`sourceIs('onair')` can return true; other names return false. Unknown
capability queries and parameters return false. APIGroup queries reflect
implemented APIs, rather than granting permission to use them. Applications
retain the existing MH-AIT permission checks.

Missing regional information remains missing. The legacy `_zipcode` key is
always a string: an empty string represents an unset or invalid postcode.
No fabricated postcode is persisted.

## Persistent arrays and event updates

Persistent-array structures describe ordered binary fields, not property
names. Repeated formats, prefix reads, signed/unsigned integers, booleans,
fixed/variable UTF-8 strings and padding retain their byte/bit positions.
Writes return the encoded byte count; absent or unreadable data returns null.
Invalid structures raise INVALID_PARAM_ERR; storage failures return NaN on
write and null on read. Receiver-owned regional data remains read-only.
Previously stored descriptor-keyed records can only be recovered when every
stored field has a distinct format; ambiguous records remain untouched and
report an unreadable result until the application writes them again.
The SDK persistent-storage module owns this released-0.2.0 reader; its removal
deadline is v1.0.0, after existing records have been rewritten by their owning
applications. `scripts/contracts/persistent-arrays.mjs` covers the recovery
boundary and ambiguous-record rejection.

Event ID listeners run when a known present event changes identity (network,
transport stream, service or event ID). Metadata-only refreshes and initial
acquisition are silent. Clearing programme information resets that baseline.

## HTML application canvas

The runtime reads `width` and `height` from the document's
`meta[name="viewport"]` and sends the declared logical canvas to the receiver
host. A document declaring `width=1920,height=1080` is rendered as a 1920×1080
application plane and fitted inside `viewport`; this also applies when the
document has no ARIB broadcast-media object. The default remains 3840×2160 when
the declaration is absent or invalid.

This is an application-document contract, not a broadcaster or transport
profile. Hosts must not override it with station-specific CSS sizing rules.

## HTML user agent

An integrating receiver may provide `userAgent` when it needs to expose an
honest Hybridcast capability token to managed HTML documents. The value is
installed before document scripts execute and restored when that runtime is
unloaded. The SDK does not add a broadcaster, smart-card, or device-vendor
identity on its own.

## Device identifiers

The default package combination remains `huggy`, `Huggy ARIB HTML5 Receiver`,
and the 48-bit identifier `4194c4ae4730`. A product host can resolve identifiers
by the requested receiver API kind without changing the runtime:

```ts
const host = new AribReceiverHost({
  iframe,
  viewport,
  getDeviceIdentifier: async kind => nativeReceiver.identifierFor(kind),
})
```

Returning `null` means that identifier kind is unavailable. Provider failures
are isolated and reported to the application as an empty identifier.

## Runtime lifecycle

`onStatus` is presentation text and may be localized. State machines must use
the typed `onLifecycle` callback instead:

```ts
const host = new AribReceiverHost({
  iframe,
  viewport,
  onStatus: text => statusLabel.textContent = text,
  onLifecycle(event) {
    if (event.type === 'error') reportRuntimeError(event.message)
  },
})
```

`loadApplication()` とアプリケーション内遷移で読み込まれた文書が receiver runtime を
導入しなかった場合は、iframe の `load` 直後に `about:blank` へ戻し、media plane を
通常視聴状態へ復元して `error`、`exited` の順に通知します。これにより VFS の未命中や
通常の 404 文書を画面へ残しません。文書の `load` 自体が発生しない要求には既定 5 秒の
watchdog を適用します。待機時間は `applicationLoadTimeoutMs` で変更でき、`0` を指定した
場合は watchdog だけを無効化します。

Lifecycle event types are `loading`, `installed`, `navigating`, `exited`,
`navigation-blocked`, `frame-blocked`, and `error`.
