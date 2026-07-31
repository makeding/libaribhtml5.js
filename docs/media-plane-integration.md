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
  }
}
```

`x`、`y`、`width`、`height` は iframe の表示 pixel ではなく、アプリケーションの
論理画布上の CSS pixel です。たとえば `screenWidth=3840`、`x=480` なら左端は 12.5% です。

`stackingPath` は html から object までの祖先を順番に格納します。ネイティブ compositor は
単一の `zIndex` だけで判断せず、この path と `documentOrder` を使ってアプリケーションとの
合成方針を決めます。ブラウザ用 `DomObjectMediaPlaneAdapter` では DOM 自身が合成するため、
この変換は不要です。

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
