# libaribhtml5

Browser-hosted ARIB HTML5 receiver-runtime prototype. The initial demo serves the
extracted BS4K application under its broadcast path and injects receiver API
polyfills before the application scripts execute.

```sh
pnpm install
pnpm dev
```

Open the URL printed by Vite. Use **透明起動ページ** for the broadcast autostart
application and **表示ページ** to inspect the visible page directly.

## SDK bundle

```sh
pnpm build:sdk
```

This produces `dist/sdk/libaribhtml5.js` and exposes `window.ARIBHTML5` with
`AribReceiverHost` and `installRuntime`. Receiver built-in sounds are maintained
as individual MP3 files under `src/runtime/romsound/`; the SDK build inlines all
of them as data URLs in the single JavaScript bundle.
