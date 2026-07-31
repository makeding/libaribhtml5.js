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

The base must be same-origin and end-user code may change it. The runtime
reports this stable scope as `receiverDevice.getSystemInformation().baseurl`.
Broadcaster startup libraries may append a selected mount such as `sh4`
themselves. Separately, HTML/CSS/runtime URL mapping derives the active mount
from the current document when resolving root-relative paths such as `/60/...`.

A production server or Service Worker should route only this prefix to its
carousel/VFS and remove the prefix before looking up the broadcast path:

```text
/data-broadcast/sh4/60/001/image/logo.png
                 -> /sh4/60/001/image/logo.png in the carousel
```

Keeping the prefix makes Worker scope and receiver-owned HTTP resources
explicit. `subt://` caption resources and `romsound://` receiver sounds are not
HTTP URLs and must not be rewritten into this namespace.

## Optional browser VFS

The SDK build emits `arib-vfs-sw.js` and exports a matching client. The demuxer
or carousel owner feeds complete resources; application/context selection stays
outside the receiver runtime:

```ts
const backend = new ServiceWorkerBroadcastVfs({
  workerUrl: '/receiver/arib-vfs-sw.js',
  baseUrl: '/data-broadcast/',
})
const vfs = new BroadcastVfsSession(backend)

await vfs.beginSession()
const revision = vfs.enqueue({ path, contentType, data })
await vfs.waitFor(revision)
await vfs.ensure(entry)
host.loadApplication(entry)
```

`enqueue()` copies a callback-lifetime `Uint8Array` synchronously. Writes are
ordered in the background and its returned revision is an application launch
barrier. `ensure()` probes the Worker and, if its memory was reclaimed, begins
a fresh Worker session and replays the page-owned resource mirror. Demuxer
context selection and the `contextId -> revision` mapping stay in the player.

`ServiceWorkerBroadcastVfs.begin()`, `put()`, and `canRead()` remain available
as low-level backend operations for hosts which already own these guarantees.

The server which hosts the Worker script must permit the chosen scope. When the
script itself is outside `/data-broadcast/`, return this response header:

```http
Service-Worker-Allowed: /data-broadcast/
```

The main player page may intentionally live outside the Worker scope. VFS
mutations and probes therefore use direct messages to the scoped active Worker;
only the data-broadcast iframe's HTTP requests are intercepted. Cache Storage
preserves the active resource session if the browser reclaims or replaces the
Worker.

HTML and CSS preparation is shared by the development middleware and Worker.
`prepareBroadcastHtml()` handles the receiver object marker, ROM-sound deferral,
root-relative URL mapping, and runtime bootstrap. `prepareBroadcastStylesheet()`
maps root-relative CSS resources into the same namespace.

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
(`🆞`). `arib-enclosed-cjk.svg` covers the defined enclosed CJK television
symbols in `U+1F200..U+1F251`, including `🈑` and `🈔`. They are minimal
subsets of the OFL-licensed Noto Sans Symbols and Noto Sans CJK JP fonts. See
`src/runtime/fonts/NOTICE.md` and `src/runtime/fonts/OFL.txt`; no commercial
font outline is included.

Modern browsers no longer reliably render SVG Fonts, so the same script emits
the corresponding WOFF files for runtime use. The runtime registers the sparse
fonts only for those code points under `ARIB Symbols` and the ARIB generic
family names `丸ゴシック`, `太丸ゴシック`, and `角ゴシック`. Ordinary Japanese
glyphs continue through the page's next fallback font. Dynamic DRCS and
broadcaster-delivered SVG/WOFF fonts stay separate from these static receiver
fonts.

Regenerate both assets with:

```sh
nix-shell -p python313Packages.fonttools --run \
  'python scripts/build-arib-symbol-font.py /path/to/NotoSansSymbols.ttf \
    --cjk-source /path/to/NotoSansCJK-VF.otf.ttc'
```
