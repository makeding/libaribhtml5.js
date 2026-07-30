# メディアスロット統合ガイド

libaribhtml5 は映像そのものを描画せず、放送アプリケーション内の
`object[type="video/x-arib2-broadcast"]` を「メディアスロット」として公開します。
ランタイムの責務は object の検出、放送 API の導入、状態通知までです。デコード、MSE、
再接続、実際の Surface は adapter の責務です。

## スロット契約

`AribMediaPlane` には次の情報が含まれます。

- `slotId`：同一 document 内で object を識別する ID
- `visible`：object と祖先の表示状態、opacity、矩形から求めた可視性
- `x` / `y` / `width` / `height`：アプリケーション論理画布上の CSS pixel
- `screenWidth` / `screenHeight`：論理画布サイズ
- `videoSource` / `audioSource`：object の `param` が指定する放送 source
- `layer.documentOrder`：document 内での object の順序
- `layer.stackingPath`：ルートから object までの position、z-index、opacity、transform

座標と layer 情報は測定値です。runtime は特定の Surface 実装や単一の z-index へ変換しません。
アプリケーションが object を移動、非表示、削除した場合は adapter と `onMediaPlane` の双方へ
反映されます。

## Adapter API

統合先は `AribMediaPlaneAdapter` を実装し、`AribReceiverHost` へ渡します。

```ts
interface AribMediaPlaneAdapter {
  readonly renderMode: 'in-object' | 'external'
  mountMediaPlane(object: HTMLElement, plane: AribMediaPlane): void
  updateMediaPlane(object: HTMLElement, plane: AribMediaPlane): void
  unmountMediaPlane(): void
}

const host = new AribReceiverHost({
  iframe,
  viewport,
  mediaPlaneAdapter,
})
```

`mountMediaPlane` の object は iframe document に実在する要素です。同一 origin の runtime
導入経路から直接 adapter へ渡され、`postMessage` で複製された値ではありません。
`updateMediaPlane` は矩形、表示状態、source、layer のいずれかが変化した時に呼ばれます。
object の削除、document 遷移、host の破棄では `unmountMediaPlane` が呼ばれます。各メソッドは
重複呼び出しに対して安全にしてください。

### `in-object`

ブラウザで正しい DOM 前後関係が必要な場合に使います。実メディアを object の fallback
content として挿入することで、object が本来持つ document order と stacking context を
そのまま利用できます。demo の `DomObjectMediaPlaneAdapter` は親 document の `<video>` を
object へ移動し、遷移時には parking container へ戻します。

```ts
const adapter = new DomObjectMediaPlaneAdapter({
  media: video,
  parkingContainer: videoSurface,
})
```

この方式なら、たとえば caption ページが要求する次の順序を同じ iframe 内で表現できます。

```text
アプリケーション背景 < 放送映像 object < 字幕説明ボタン
```

### `external`

ネイティブ Surface、ブラウザ plugin、専用 compositor を使う場合に指定します。adapter は
`AribMediaPlane` の矩形と `stackingPath` を実装固有の合成 API へ渡します。runtime は元の
object を透明なスロットとして残します。DOM の z-index 値をそのままネイティブ z-order と
みなさず、compositor 側で iframe 内容との合成規則を定義してください。

## 背面 iframe fallback の制限

`BehindIframeMediaPlaneAdapter` は既存統合向けの簡易互換 adapter です。映像 surface を
iframe の背面へ置き、スロット矩形を percentage へ変換します。

```text
映像 surface < iframe 全体
```

この構成では iframe 内部の要素を映像の前後へ分けられません。透明部分から映像を見せ、
アプリ全体を映像より前に置くページに限って使用できます。caption ページのような
「アプリ背景 < 映像 < アプリ UI」は再現不能です。これは fallback であり、共通の推奨
合成方式ではありません。

`videoSurface` だけを `AribReceiverHost` に渡した旧 API は、この adapter を自動生成します。
`attachVideo()` と `keepVideoVisible` も互換用に残していますが、新規統合では明示的な adapter
を使用してください。

## ライフサイクル

放送アプリケーションの document とメディアセッションは別のライフサイクルです。

| 状態 | adapter |
| --- | --- |
| object を初めて検出 | `mountMediaPlane(object, plane)` |
| 矩形・表示・source・layer が変化 | `updateMediaPlane(object, plane)` |
| object は存在するが非表示 | `updateMediaPlane(... visible: false)` |
| object 削除 / pagehide / host destroy | `unmountMediaPlane()` |

adapter は単なるアプリページ遷移で decoder を破棄する必要はありません。`unmountMediaPlane`
では表示先との関連だけを解除し、チャンネル、番組、source が変わった時に統合側が decoder、
字幕 track、`setProgramInfo()` を更新します。

通常の放送字幕は映像 renderer と同じメディア plane に属します。一方、D Data の字幕
コンテンツはアプリケーション DOM です。`setCaptionTracks()` / `pushCaption()` から iframe
へ渡し、親プレーヤー字幕として二重描画しないでください。

## 確認項目

- object の位置、サイズ、visibility、削除が adapter へ反映される。
- object 前後にあるアプリ DOM が期待通り映像の前後へ描画される。
- stacking context を作る祖先の z-index、opacity、transform が `stackingPath` に含まれる。
- document 遷移で古い Surface が残らず、decoder セッションは必要に応じて維持される。
- `BehindIframeMediaPlaneAdapter` を使用する場合、その合成制限が製品要件上許容される。

---

# Media-slot integration guide (English)

libaribhtml5 treats `object[type="video/x-arib2-broadcast"]` as a media slot. The
runtime reports its identity, visibility, logical-canvas geometry, sources,
document order, and stacking path. Decoding and rendering belong to an
`AribMediaPlaneAdapter` supplied by the host.

An `in-object` adapter renders at the actual object node. The demo uses
`DomObjectMediaPlaneAdapter` to adopt its `<video>` into the object's fallback
content, preserving application DOM ordering. This supports layouts such as:

```text
application background < broadcast video < application controls
```

An `external` adapter binds the slot to a native Surface, plugin, or compositor.
It must translate `AribMediaPlane.layer.stackingPath` into that renderer's own
composition model.

`BehindIframeMediaPlaneAdapter` is compatibility-only. It can render only
`video < entire iframe`; it cannot interleave video with elements inside the
iframe. Passing the legacy `videoSurface` option without an explicit adapter
selects this fallback automatically.

Adapters receive `mountMediaPlane(object, plane)`, `updateMediaPlane(object,
plane)`, and `unmountMediaPlane()`. They should detach presentation on document
navigation without unnecessarily destroying the decoder or media session.
