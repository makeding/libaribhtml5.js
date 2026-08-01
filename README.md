# libaribhtml5

[日本語](#日本語) | [English](#english)

## 日本語

ブラウザ上で動作する ARIB HTML5 受信機ランタイムのプロトタイプです。初期デモでは、
展開済みの BS4K アプリケーションを放送時のパスで配信し、アプリケーションの
スクリプトが実行される前に受信機 API のポリフィルを注入します。

```sh
pnpm install
pnpm dev
```

Vite が出力した URL を開いてください。放送による自動起動アプリケーションには
**透明起動ページ**を、表示ページを直接確認するには**表示ページ**を使用します。

### 注意事項

- 放送アプリケーションが利用する一部のオンラインデータは、ブラウザから放送局の
  サーバーへ直接リクエストされます。現在のデモでは、安全のため、このような外部への
  ネットワークリクエストをすべてブロックしています。
- ACAS のシリアル番号は `0721 0721 0721 0724 9674` に固定してエミュレートしています。

### SDK バンドル

npm から利用する場合は、パッケージをインストールして ESM エントリを import します。

```sh
npm install libaribhtml5
```

```ts
import { AribReceiverHost, installRuntime } from 'libaribhtml5'
```

従来の `<script>` 向け IIFE は `libaribhtml5/iife`、Service Worker ファイルは
`libaribhtml5/arib-vfs-sw.js` として公開されます。

```sh
pnpm build:sdk
```

このコマンドは `dist/sdk/libaribhtml5.js` と、ブラウザ VFS 用の
`dist/sdk/arib-vfs-sw.js` を生成します。SDK は `AribReceiverHost`、
`ServiceWorkerBroadcastVfs`、`installRuntime` を持つ `window.ARIBHTML5` を公開します。受信機内蔵音は
`src/runtime/romsound/` 以下で個別の MP3 ファイルとして管理され、SDK のビルド時に
すべてデータ URL として単一の JavaScript バンドルへ埋め込まれます。iOS/iPadOS では短い内蔵音が
主動画の media session を奪わないよう、`romsound://` の再生を成功扱いの no-op にします。

プレーヤーへ統合する際のメディアスロット、adapter、レイヤー、ライフサイクル、字幕の契約は
[メディアプレーン共通統合ガイド](docs/media-plane-integration.md)を参照してください。
[ブラウザ iframe 合成の注意事項](docs/browser-iframe-compositing.md)には、Chromium の
`color-scheme` backdrop と external media hole の実装条件をまとめています。
データ放送へ入る時は `host.loadApplication()`、通常プレーヤーへ戻す時は
`host.exitApplication()` を使用します。
MH-AIT の `AUTOSTART` / `PRESENT` / `KILL`、紅白等の連動 application、
`replaceApplication()` と EMT の責務境界は
[MH-AIT アプリケーションライフサイクル](docs/application-lifecycle.md)を参照してください。

録画再生ではシステム時計ではなく、ストリームの NTP と再生位置を
`host.setBroadcastClock()` へ渡します。変換例は
[録画再生時の放送時計](docs/broadcast-clock.md)を参照してください。

EIT 由来の番組情報と受信機固有情報を host から渡す契約は
[receiver host contracts](docs/receiver-host-contracts.md)を参照してください。

Service Worker の `/data-broadcast/` ルーティング、データ放送リソースの
store/update/release ライフサイクル、および ARIB 追加記号フォントは
[放送リソースとフォント](docs/broadcast-resources-and-fonts.md)を参照してください。

Android/WebView の「放送予定」検索結果から受信機所有の番組表・番組詳細を開く場合は、
[`onOpenProgramGuide` とブラウザ fallback](docs/android-program-guide.md)を参照してください。

## English

Browser-hosted ARIB HTML5 receiver-runtime prototype. The initial demo serves the
extracted BS4K application under its broadcast path and injects receiver API
polyfills before the application scripts execute.

```sh
pnpm install
pnpm dev
```

Open the URL printed by Vite. Use **透明起動ページ** for the broadcast autostart
application and **表示ページ** to inspect the visible page directly.

### Notes

- Some online data used by broadcast applications is requested directly from the
  browser to the broadcaster's servers. For safety, the current demo blocks all
  such external network requests.
- The ACAS serial number is emulated with the fixed value
  `0721 0721 0721 0724 9674`.

### SDK bundle

Install the package to use its typed ESM entry point:

```sh
npm install libaribhtml5
```

```ts
import { AribReceiverHost, installRuntime } from 'libaribhtml5'
```

The browser-global IIFE remains available as `libaribhtml5/iife`, and the
Service Worker is exported as `libaribhtml5/arib-vfs-sw.js`.

```sh
pnpm build:sdk
```

This produces `dist/sdk/libaribhtml5.js` plus `dist/sdk/arib-vfs-sw.js` for the
optional browser VFS, and exposes `window.ARIBHTML5` with `AribReceiverHost`,
`ServiceWorkerBroadcastVfs`, and `installRuntime`. Receiver built-in sounds are maintained
as individual MP3 files under `src/runtime/romsound/`; the SDK build inlines all
of them as data URLs in the single JavaScript bundle. On iOS and iPadOS,
`romsound://` playback is a successful no-op so a short receiver sound cannot
replace the main video's active media session.

See the [common media-plane integration guide](docs/media-plane-integration.md)
for the shared video layering, geometry, lifecycle, and caption contract.
See [broadcast resources, Worker routing, and fonts](docs/broadcast-resources-and-fonts.md)
for the `/data-broadcast/` namespace and cache/font lifecycle.
See [Android program-guide integration](docs/android-program-guide.md) for handing a
future-program result to a receiver-owned WebView/native EPG with a browser fallback.
See [receiver host contracts](docs/receiver-host-contracts.md) for program metadata
and receiver-owned system information.
See [MH-AIT application lifecycle](docs/application-lifecycle.md) for AUTOSTART,
PRESENT, KILL, `replaceApplication()`, and the EMT delivery boundary.
