# Broadcast resources, Worker routing, and fonts

## URL namespace

`AribReceiverHost` mounts receiver paths below `/data-broadcast/` by default:

```ts
const host = new AribReceiverHost({
  iframe,
  viewport,
  broadcastBaseUrl: '/data-broadcast/',
})

host.loadApplication('/sh4/40/001/startup/html/index.html')
// iframe: /data-broadcast/sh4/40/001/startup/html/index.html
```

The base must be same-origin and end-user code may change it. The runtime also
reports this value as `receiverDevice.getSystemInformation().baseurl`, so
broadcaster libraries construct carousel URLs inside the same namespace.

A production server or Service Worker should route only this prefix to its
carousel/VFS and remove the prefix before looking up the broadcast path:

```text
/data-broadcast/sh4/60/001/image/logo.png
                 -> /sh4/60/001/image/logo.png in the carousel
```

Keeping the prefix makes Worker scope and receiver-owned HTTP resources
explicit. `subt://` caption resources and `romsound://` receiver sounds are not
HTTP URLs and must not be rewritten into this namespace.

## Stored-resource lifecycle

`navigator.receiverDevice.cacheEvent.storeDataResource()` now waits for the
complete response before dispatching `store_finished`. A failed response emits
`store_failed`; `releaseDataResource()` aborts an in-flight request. Page exit
releases every retained resource.

The default implementation fetches from the broadcast document, which lets a
Service Worker controlling `/data-broadcast/` handle and cache the request. A
native carousel or another VFS may instead provide `resourceStore`:

```ts
const host = new AribReceiverHost({
  iframe,
  viewport,
  resourceStore: {
    async store(url, { signal }) {
      await carousel.retain(url, signal)
    },
    release(url) {
      return carousel.release(url)
    },
  },
})
```

When a carousel module changes, notify the active application. An update is
downloaded again before its listener receives `updated`; deletion aborts and
releases it before the listener receives `deleted`.

```ts
host.notifyDataResource('/sh4/60/001/font/service.woff', 'updated')
host.notifyDataResource('/sh4/60/001/font/service.woff', 'deleted')
```

CSS fonts referenced by a d-data page are ordinary broadcast HTTP resources
and therefore follow the Worker route. A font explicitly retained through
`storeDataResource()` additionally follows the lifecycle above. TTML
`subt://n` fonts remain part of the caption data pipeline.

## Receiver symbol font

`src/runtime/fonts/arib-symbols.svg` is the auditable SVG Font source for the
television-symbol block `U+1F19B..U+1F1AC`, including `U+1F19E SQUARED FOUR K`
(`🆞`). They are a minimal subset of the OFL-licensed Noto Sans Symbols font
used by the reference receiver. See `src/runtime/fonts/NOTICE.md` and
`src/runtime/fonts/OFL.txt`; no commercial font outline is included.

Modern browsers no longer reliably render SVG Fonts, so the same script emits
`arib-symbols.woff` for runtime use. The runtime registers the sparse font only
for its 18 code points under `ARIB Symbols` and the ARIB generic family names
`丸ゴシック`, `太丸ゴシック`, and `角ゴシック`. Ordinary Japanese glyphs continue
through the page's next fallback font. Dynamic DRCS and broadcaster-delivered
SVG/WOFF fonts stay separate from this static receiver font.

Regenerate both assets with:

```sh
nix-shell -p python313Packages.fonttools --run \
  'python scripts/build-arib-symbol-font.py /path/to/NotoSansSymbols.ttf'
```
