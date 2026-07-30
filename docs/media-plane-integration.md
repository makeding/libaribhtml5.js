# メディアプレーン共通統合ガイド

この文書は、ARIB HTML5 アプリケーションを通常のブラウザ用プレーヤーへ重ねる際の
共通契約を定義します。対象は映像の表示・位置・重なり順とプレーヤー字幕です。ストリームの
デコード、MSE の復旧、再接続方式はプレーヤー固有の責務であり、この契約には含めません。

## プレーンの重なり順

同じ `.viewport` の中では、次の順序を固定します。

| 前後関係 | プレーン | 現在の要素 | 用途 |
| --- | --- | --- | --- |
| 前面 | 放送アプリケーション | `#broadcast` | アプリケーションの HTML、メニュー、案内 |
| 背面 | 放送映像 | `.video-surface` | 実映像を表示する `<video>` |
| 最背面 | ステージ背景 | `.viewport` | アプリケーションが指定した背景色 |

推奨値は、映像 `z-index: 0`、アプリケーション `z-index: 1` です。
値そのものではなく、この相対順序を統合先でも維持してください。

```css
.viewport { position: relative; overflow: hidden; }
.video-surface { position: absolute; z-index: 0; pointer-events: none; }
#broadcast { position: absolute; z-index: 1; background: transparent; }
.broadcast-video { display: block; width: 100%; height: 100%; object-fit: contain; }
```

放送アプリケーション内の `object[type="video/x-arib2-broadcast"]` は映像の表示領域を
指定するプレースホルダーです。ランタイムはこの要素を透明にし、実映像は宿主側の
`.video-surface` に表示します。iframe 自体も透明にすることで、アプリケーションの
透明部分から背面の映像が見え、不透明なメニューや案内は映像より前に表示されます。

ブラウザ標準の `<video controls>` は使用しないでください。標準コントロールは
ブラウザ固有の合成レイヤーを作ることがあり、放送アプリケーションとの重なり順を
一貫して制御できません。操作 UI は viewport の外側に置くか、専用の宿主プレーンを
別途定義します。

## 映像のサイズと位置

`AribVideoPlane` の `x`、`y`、`width`、`height` は、放送アプリケーションの
論理画布上の CSS ピクセルです。`screenWidth` と `screenHeight` は、その論理画布の
大きさです。座標原点は左上です。

```text
left   = x      / screenWidth  * 100%
top    = y      / screenHeight * 100%
width  = width  / screenWidth  * 100%
height = height / screenHeight * 100%
```

たとえば、論理画布 `3840 x 2160` に対して映像が `2880 x 1620 / 位置 480,54` の場合、
宿主上の矩形は `left: 12.5%`、`top: 2.5%`、`width: 75%`、`height: 75%` です。

統合先は次の条件を守ります。

- iframe と映像面は、必ず同じ viewport、原点、アスペクト比を共有する。
- 外側の表示サイズが変わっても、両方へ同じスケールを適用する。片方だけを拡大・移動しない。
- 映像面の矩形は `object` の矩形に一致させる。プレーヤーのコントロールや黒帯を矩形計算へ含めない。
- `visible: false`、要素の削除、`display: none`、`visibility: hidden`、または幅・高さ 0 の場合は映像面を隠す。
- 不正な数値や論理画布外の矩形を受け取った場合は表示せず、診断情報を残す。負数やはみ出しを暗黙に補正しない。

`<video>` の `object-fit` は映像面の座標契約とは別です。現在の demo は `contain` を
使用します。統合先で `fill` や `cover` を選ぶ場合も、`.video-surface` 自体の位置と
大きさは変更しません。

## ライフサイクル

放送アプリケーションのページ遷移と、映像ストリームのセッションは別のライフサイクルです。
ページ遷移のたびにプレーヤーを破棄すると映像が途切れるため、通常は `<video>` と
プレーヤーを保持し、映像面だけを表示・非表示にします。

| イベント | 映像面 | プレーヤー |
| --- | --- | --- |
| `attachVideo()` | 非表示のまま接続 | 接続済み |
| `loadApplication()` | 直ちに非表示 | 原則維持 |
| runtime `installed` | 最初の plane 通知まで非表示 | 原則維持 |
| `video-plane: visible` | 指定矩形で表示 | 必要なら source を選択 |
| `video-plane: hidden` | 非表示 | 停止・破棄しない |
| `unloading` / `destroy` / blocked frame | 非表示 | 原則維持 |
| host `destroy()` | 非表示・切断 | 統合側で解放 |

チャンネル変更、番組変更、またはストリーム URL の変更は、ページ遷移とは別に統合側が
判断します。その場合だけ、必要に応じてプレーヤーを再ロードし、`resetCaptions()`、
`setCaptionTracks()`、`setProgramInfo()` の順で新しい番組状態を設定します。

`keepVideoVisible` は「アプリケーションが映像 object を持たない間も全画面映像を残す」
受信機向けの選択肢です。アプリケーションの object による表示制御を再現する demo では
既定値 `false` を使用します。

## 字幕

通常の放送字幕はプレーヤーの機能として扱います。字幕 renderer を別の受信機プレーンには
分離せず、`<video>` またはプレーヤー自身のコンテナ内に置きます。したがって字幕は
`video-plane` の位置・大きさ・表示状態を自動的に共有し、別の座標同期 API は必要ありません。

D Data の「字幕コンテンツ」は通常の放送字幕とは別物です。`setCaptionTracks()` と
`pushCaption()` で runtime へデータを渡し、放送アプリケーションが
`isCaptionExistent()` / `addCaptionListener()` を通じて iframe 内に描画します。
これはアプリケーション DOM の一部であり、親ページのプレーヤー字幕へ移動しません。

番組またはプレーヤーの字幕 track が変わった場合は、プレーヤー側で古い cue と遅延状態を
消してから新しい track を有効にします。単なる D Data ページ遷移では、番組が同一なら
プレーヤーの字幕 renderer を再起動しません。

## 統合時の確認項目

- 全画面映像の上へアプリケーションのメニューを開き、メニュー全体が映像より前に出る。
- `2880 x 1620 / 位置 480,54` の映像が論理画布上の指定矩形と一致する。
- object の移動、リサイズ、非表示、削除が映像面へ反映される。
- viewport のリサイズ後もアプリケーション、映像、プレーヤー字幕の相対位置がずれない。
- アプリケーション遷移中は映像面が隠れ、旧ページの位置が一瞬残らない。
- 通常の放送字幕がプレーヤーの映像領域と一緒に移動・拡大縮小・非表示になる。
- D Data の字幕コンテンツを通常の放送字幕として二重描画しない。
- 外部通信やデコードエラーが発生しても、媒体プレーンの状態とは別に診断できる。

---

# Common media-plane integration guide (English)

This contract covers video visibility, geometry, stacking, and captions when an
ARIB HTML5 application is hosted by a browser player. Stream decoding, MSE
recovery, and reconnect policy remain player-specific concerns.

The required back-to-front order is: stage background, video surface, then the
application iframe. The recommended z-index values are `0` and `1` for video
and application respectively. The
broadcast video object is only a geometry placeholder; it is made transparent
inside the iframe while the real video is rendered behind the transparent
application plane. Do not use native `<video controls>` in receiver mode.

`AribVideoPlane` geometry is expressed in the application's logical canvas. Map
it to the common viewport using percentages:

```text
left   = x      / screenWidth  * 100%
top    = y      / screenHeight * 100%
width  = width  / screenWidth  * 100%
height = height / screenHeight * 100%
```

The iframe and video surface must share the same origin, aspect ratio, and
scale. A `2880 x 1620` plane at `480,54` in a `3840 x 2160` canvas
therefore maps to `12.5%, 2.5%, 75%, 75%`. Hide the surface when the object is
missing or invisible. Reject invalid or out-of-bounds geometry rather than
silently changing the application's layout.

Application navigation and the media session have separate lifecycles. Hide the
video surface while a new runtime is loading, but normally keep the player and
`<video>` alive. Show it only after a visible plane notification. Destroy the
player only when the host or media session ends, or when a source change requires
it. On a program change, reset captions before installing the new track and
program metadata.

Normal broadcast subtitles belong to the player and stay inside its video or
player container, so they automatically share the `video-plane` geometry and
visibility. D Data caption content is separate: `setCaptionTracks()` and
`pushCaption()` deliver it to the iframe for `isCaptionExistent()` /
`addCaptionListener()`. It remains application DOM and must not be duplicated as
a parent-page subtitle layer.
