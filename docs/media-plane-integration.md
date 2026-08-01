# メディアスロットの使い方

## まず結論

通常は次のどれか一つを選びます。

| 用途 | 選ぶもの | できる重なり順 |
| --- | --- | --- |
| 通常ブラウザの demo / Web プレーヤー | `DomObjectMediaPlaneAdapter` | アプリ背景 `<` 映像 `<` アプリ UI |
| ネイティブ Surface / plugin / compositor | 独自 `AribMediaPlaneAdapter` | compositor の能力に依存 |
| 既存コードを当面維持 | `BehindIframeMediaPlaneAdapter` | 映像 `<` iframe 全体のみ |

caption ページを正しく表示するなら、1 番目または 2 番目が必要です。
`BehindIframeMediaPlaneAdapter` では実現できません。

## 背景プレーンの制約

BS4K/BS8K の背景は、データ放送ページが任意に選ぶ壁紙ではありません。受信機は
マルチメディアプレーンより後ろに、画面全体を覆う単色の背景プレーンを持ちます。
前面のプレーンが透明、または何も描画していない画素だけに、この色が見えます。

MMT の source of truth は LCT です。実装時の優先順位は次の通りです。

1. LCT の `Background_Color_Descriptor` があれば、その RGB 各 8 bit の値を使う。
2. LCT の色をまだ受け取っていない間は、アプリケーションが報告した stage の単色を互換
   fallback として使ってよい。ただし、これはアプリケーション CSS を LCT と解釈するものではない。
3. どちらも得られない間の receiver-owned fallback は黒 (`#000`) とする。

この fallback は規格上の既定色ではありません。白いブラウザ canvas の露出を避けるための
実装上の選択です。確認に使った NHK BS8K の `8k.mmts` から抽出したファイルも、
`top/source/top.css` の `body` と `#vstream`、および
`caption/source/caption.css` の `#backscreen` と `.bs8k #container` に黒を指定しています。
したがって、このサンプル用に背景画像やグラデーションを追加しません。

背景の実装には、さらに次の制約があります。

- 背景プレーンは viewport 全体を覆い、映像、アプリケーション、字幕、文字スーパーより後ろに置く。
- LCT の色はアプリケーションやサービスの切り替え時に引き継がない。新しい LCT を受け取るまでは
  fallback に戻す。
- `in-object` adapter では、runtime はアプリケーションの `html` / `body` を透明化しない。
  放送アプリケーションが指定した背景色や背景画像は multimedia plane の描画として保持する。
- `external` adapter では、外部映像面を iframe 越しに見せるため application canvas を透明化する。
  その場合は receiver 背景、外部映像、iframe を別々の sibling layer として、この順に重ねる。
  receiver 背景と iframe を同じ wrapper に入れると、外部映像を両者の間へ合成できない。
  application canvas を透明化する前の stage 色は receiver viewport の最背面に移し、映像領域外に
  host アプリの背景が露出しないようにする。stage 色を取得できない間の fallback は黒とする。
- dark theme の host に light canvas の放送ページを埋め込む場合、iframe owner と iframe 内 root に
  `color-scheme: only light` を明示する。Chromium は owner と iframe 内の root で used color scheme が
  異なると、`html` / `body` の computed background が透明でも、不透明な scheme backdrop
  （light の場合は白）を frame canvas に描画する。これは CSS の `background`、iframe の
  `z-index`、`opacity` では除去できない。
- `#vstream` 等、media object の祖先が不透明な背景を描く場合、external runtime はその祖先の
  背景だけを media object の存続中に透明化する。兄弟要素の UI は変更しない。video を iframe
  より前へ上げて穴を作ってはならない。そうすると字幕説明など、映像より前にあるべき
  application UI まで隠れる。
- `#vstream > object#av` のように media object と同じ矩形で object だけを子に持つ wrapper は、
  背景だけでなく wrapper 自身を `opacity: 0` にする。高い `z-index` の純 media wrapper が作る
  空の compositing layer を残さないためであり、字幕や操作 UI を含む wrapper には適用しない。
- 映像の位置と寸法は、どちらの adapter でも放送アプリケーションが宣言した video object に従う。
- 放送アプリケーション内の背景画像、要素背景、半透明 UI は multimedia plane の描画であり、
  LCT の背景色を置き換えない。
- native compositor でも DOM 実装でも、LCT の単色を iframe 内の装飾要素として実装しない。
  動画領域の切り抜きや iframe のページ遷移から独立した、受信機所有の最背面レイヤーにする。

Chromium の `color-scheme` backdrop、external media hole、DevTools での切り分けは
[ブラウザ iframe 合成の注意事項](browser-iframe-compositing.md)も参照してください。

根拠は `../ARIB-docs` の次の条項です。

- ARIB STD-B62 1.5版 第一編 第1部 5.2(4): 背景プレーンは最背面で、前面が透明または
  未描画の部分に指定色を表示する。
- 同 5.3: MMT 方式の受信機は LCT で指定された色を背景プレーンへ描画して合成する。
- 同 6.1.1: 背景プレーンは 7680x4320、BT.2020 系の RGB 各 8 bit として定義される。
- ARIB STD-B60 1.5版 7.3.3.3 および 7.4.3.3: LCT と
  `Background_Color_Descriptor` (`descriptor_tag=0x8002`) を定義し、24 bit を RGB 各 8 bit
  の背景色として扱う。

## ブラウザへ組み込む最小コード

普通の動画表示領域とデータ放送 iframe を同じ viewport に置きます。

```html
<div id="viewport">
  <div id="normal-player">
    <video id="video" autoplay muted playsinline></video>
  </div>
  <iframe id="broadcast"></iframe>
</div>
```

この iframe は受信機が管理する同一 origin のコンテンツです。
`sandbox="allow-scripts allow-same-origin"` は指定しないでください。同一 origin の
script は sandbox 属性を除去できるため、ブラウザも security boundary にならないと
警告します。一方で `allow-same-origin` を外すと、host から受信機 API を導入できません。
受信機が信頼しないアプリケーションには、この in-process runtime ではなく別 origin の
integration が必要です。

`DomObjectMediaPlaneAdapter` に既存の video と、データ放送を終了した時に video を戻す
通常プレーヤー container を渡します。

```ts
import {
  AribReceiverHost,
  DomObjectMediaPlaneAdapter,
  type RuntimeWindow,
} from 'libaribhtml5'

const iframe = document.querySelector<HTMLIFrameElement>('#broadcast')!
const viewport = document.querySelector<HTMLElement>('#viewport')!
const normalPlayer = document.querySelector<HTMLElement>('#normal-player')!
const video = document.querySelector<HTMLVideoElement>('#video')!

// dark theme の host でも、放送ページの標準 light canvas と scheme を一致させる。
iframe.style.colorScheme = 'light'

const host = new AribReceiverHost({
  iframe,
  viewport,
  mediaPlaneAdapter: new DomObjectMediaPlaneAdapter({
    media: video,
    normalPlayerContainer: normalPlayer,
  }),
})

window.__ARIB_HTML5_INSTALL__ = (child: RuntimeWindow) => {
  host.installRuntime(child)
}
```

`AribReceiverHost` は全面 iframe を表示専用の inert overlay として扱うため、データ放送の描画を
残したまま touch/mouse 操作と `:hover` は下のプレーヤー UI へ通り、iframe 内へ browser focus も
移りません。`pointer-events: none !important` と `tabindex="-1"` も互換用 fallback として設定します。
放送アプリケーションのリモコン操作には `host.dispatchKey()` を使用してください。

データ放送への出入りは次の二つだけです。

```ts
// データ放送へ入る。video は放送 object の中へ移動する。
// The receiver path is mounted at /data-broadcast/sh4/... by default.
host.loadApplication('/sh4/40/001/startup/html/index.html')

// データ放送を終了する。iframe を閉じ、video を通常プレーヤーへ戻して表示する。
host.exitApplication()
```

ページ内の「戻る」はアプリケーション内遷移です。`exitApplication()` ではありません。
テレビ UI の「データ放送終了」操作、チャンネル変更、または
`applicationManager.destroyApplication()` を受けた時だけ `exitApplication()` を呼びます。

## 実行時に何が起きるか

```text
通常プレーヤー
  host.loadApplication()
        ↓
runtime が broadcast object を検出
  mountMediaPlane(object, plane)
        ↓
データ放送ページ内で object が移動・非表示
  updateMediaPlane(object, plane)
        ↓
別のデータ放送 document へ遷移
  unmountMediaPlane('document-unload') → 次ページで mount
        ↓
host.exitApplication()
  unmountMediaPlane('application-exit')
        ↓
通常プレーヤーへ video / Surface を戻す
```

`DomObjectMediaPlaneAdapter` は `document-unload` では video を通常 container へ一時退避して
非表示にします。`application-exit` の時だけ通常 container を全画面表示します。この区別に
より、データ放送のページ遷移中に普通のプレーヤー UI が点滅しません。

## 独自 adapter を書く

ネイティブ Surface や compositor を使う場合の最小骨格です。

```ts
import type {
  AribMediaPlane,
  AribMediaPlaneAdapter,
  AribMediaPlaneUnmountReason,
} from 'libaribhtml5'

class NativeSurfaceAdapter implements AribMediaPlaneAdapter {
  readonly renderMode = 'external' as const

  mountMediaPlane(object: HTMLElement, plane: AribMediaPlane): void {
    nativeSurface.bindBroadcastSource(plane.videoSource, plane.audioSource)
    this.updateMediaPlane(object, plane)
  }

  updateMediaPlane(_object: HTMLElement, plane: AribMediaPlane): void {
    nativeSurface.setVisible(plane.visible)
    nativeSurface.setLogicalCanvas(plane.screenWidth, plane.screenHeight)
    nativeSurface.setRect(plane.x, plane.y, plane.width, plane.height)
    nativeSurface.setApplicationLayer(plane.layer)
  }

  unmountMediaPlane(reason: AribMediaPlaneUnmountReason): void {
    if (reason === 'application-exit') {
      nativeSurface.returnToNormalPlayer()
    } else if (reason === 'host-destroy') {
      nativeSurface.release()
    } else {
      nativeSurface.hide()
    }
  }
}
```

`unmountMediaPlane` の reason は次の意味です。

| reason | adapter の動作 |
| --- | --- |
| `slot-removed` | decoder は維持し、Surface を隠す |
| `document-unload` | 次のデータ放送ページに備えて一時退避する |
| `application-exit` | 通常プレーヤーへ映像を戻して表示する |
| `host-destroy` | listener、Surface、decoder など所有資源を解放する |

各メソッドは同じ状態で複数回呼ばれても壊れないように実装してください。

## `AribMediaPlane` の読み方

```ts
type AribMediaPlane = {
  slotId: string
  visible: boolean
  x: number
  y: number
  width: number
  height: number
  screenWidth: number
  screenHeight: number
  videoSource?: string
  audioSource?: string
  layer: {
    documentOrder: number
    stackingPath: Array<{
      tagName: string
      id?: string
      position: string
      zIndex: string
      display: string
      visibility: string
      opacity: number
      transform: string
    }>
    externalPlacement?: 'behind-application' | 'above-application'
  }
}
```

`x`、`y`、`width`、`height` は iframe の表示 pixel ではなく、アプリケーションの
論理画布上の CSS pixel です。たとえば `screenWidth=3840`、`x=480` なら左端は 12.5% です。

`stackingPath` は html から object までの祖先を順番に格納します。ネイティブ compositor は
単一の `zIndex` だけで判断せず、この path と `documentOrder` を使ってアプリケーションとの
合成方針を決めます。ブラウザ用 `DomObjectMediaPlaneAdapter` では DOM 自身が合成するため、
この変換は不要です。

`externalPlacement` は iframe 外の video を使うブラウザ統合向けの限定的なヒントです。
`above-application` は、既定寸法の object を包む media-only wrapper が正の `z-index` を持つ場合にだけ
報告されます。この場合、host は media surface 全体を iframe より前の stacking level にできます。
ただし iframe 内部との完全な interleave はできないため、映像枠と重なる application UI がある実装では
`in-object` adapter を使用してください。

## なぜ iframe 背面方式では不足するか

iframe と親 document の間で選べるのは次の順序だけです。

```text
映像 < iframe 全体
```

一方、caption ページの要求は次です。

```text
iframe 内の背景 < 映像 < iframe 内の字幕説明ボタン
```

親側の z-index を何度変更しても、iframe の内部を二つに分割できません。
`DomObjectMediaPlaneAdapter` は video を object の fallback content にすることで解決します。
ネイティブ統合では compositor が同じ役割を担当します。

旧 API の `videoSurface` だけを `AribReceiverHost` に渡すと、互換のため自動的に
`BehindIframeMediaPlaneAdapter` が選択されます。`attachVideo()` と `keepVideoVisible` も
旧統合用です。新規コードでは使用しないでください。

## 字幕

通常の放送字幕は video / native Surface と同じプレーヤー側 renderer に置きます。
したがって media plane の移動、非表示、通常プレーヤーへの復帰へ一緒に追従します。

D Data の字幕コンテンツはアプリケーション DOM です。`setCaptionTracks()` と
`pushCaption()` で iframe へ渡し、通常の放送字幕として親側へ二重描画しないでください。
アプリケーションが `addCaptionListener()` を登録している間は
`onCaptionSubscription` に要求中の component tag が通知されます。ネイティブ受信機は
この通知を使い、同じ字幕を通常の字幕 renderer で二重表示しないようにできます。

---

## English summary

Use `DomObjectMediaPlaneAdapter` for browser integration, implement
`AribMediaPlaneAdapter` for a native Surface/compositor, and use
`BehindIframeMediaPlaneAdapter` only as a limited compatibility fallback.

Call `host.loadApplication()` to enter data-broadcast mode. Call
`host.exitApplication()` to leave it; this produces
`unmountMediaPlane('application-exit')`, hides the iframe, and lets the adapter
return video to the ordinary player. A data-broadcast document navigation uses
`document-unload` instead and must not flash the ordinary player UI.
