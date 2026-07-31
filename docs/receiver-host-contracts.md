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

`baseurl` is generated from the current document mount. For example, a document
under `/data-broadcast/bsfuji4k/...` exposes
`/data-broadcast/bsfuji4k/`. An injected `baseurl` cannot override that value.

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
    if (event.type === 'installed') clearApplicationTimeout()
    if (event.type === 'navigating') armApplicationTimeout()
    if (event.type === 'error') reportRuntimeError(event.message)
  },
})
```

Lifecycle event types are `loading`, `installed`, `navigating`, `exited`,
`navigation-blocked`, `frame-blocked`, and `error`.
