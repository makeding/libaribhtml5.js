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
