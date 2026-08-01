# ブラウザ iframe 合成の注意事項

この文書は、通常ブラウザでデータ放送 iframe と既存プレーヤーの `<video>` を合成する際の
ブラウザ固有の制約をまとめます。ARIB のプレーン順序そのものは
[メディアプレーン統合ガイド](media-plane-integration.md)を参照してください。

## 必須のレイヤー構成

外部映像面を使う場合は、同じ 16:9 container の sibling として次の順に置きます。

```text
z=0  receiver-owned background plane
z=1  プレーヤーが所有する既存 video
z=2  データ放送 iframe
```

video の複製や canvas への 1:1 コピーは行いません。MSE に接続済みのプレーヤー所有 video を
media object の矩形へ移動・リサイズして使います。video を iframe より前へ上げると、字幕説明、
ダイアログ、字幕ボタンなど本来映像より前にある application UI まで隠れるため禁止です。

iframe 内の `object[type="video/x-arib2-broadcast"]` は映像そのものではなく、外部 video plane の
位置・寸法・可視状態を宣言する geometry anchor として残します。external adapter は object の描画を
`opacity: 0 !important` で隠します。さらに `#vstream > object#av` のように、object と同じ矩形で
object だけを子に持つ media-only wrapper は wrapper 自身も隠します。wrapper が高い `z-index` の
独立した compositing layer を作る場合、背景だけを透明化しても Chromium が外部 video の上へその layer を
残すためです。字幕、ダイアログ、操作 UI を含む祖先は media-only wrapper として扱いません。

放送ページが object 自身に `width` / `height` を指定せず、positioned wrapper だけに映像枠の寸法を
指定する場合があります。通常ブラウザはその object を 300 x 150 の既定 replaced-element として計測しますが、
receiver runtime は object が wrapper の唯一の子である場合に限り wrapper を media slot として採用します。
この wrapper は外部合成中だけ object と一緒に透明化されるため、放送ページが指定した高い `z-index` を
削除したり、host の video を iframe より前へ出したりする必要はありません。

ただし、異なる寸法の media-only wrapper が正の `z-index` を持つ場合、その video slot はページ背景の
前に置くことを意図した foreground media です。runtime は `layer.externalPlacement` を
`above-application` として報告します。external adapter はこの場合だけ media surface を application
iframe より前の layer に置きます。標準の `BehindIframeMediaPlaneAdapter` は通常 `z=0`、この場合だけ
`z=2` を使います（必要なら `behindZIndex` / `aboveZIndex` で host の stacking context に合わせます）。
通常の全面映像や application background として使われる slot は `behind-application` のままです。

`display: none`、`visibility: hidden`、`content-visibility: hidden` は矩形計測または可視判定を壊すため
使用しません。runtime は隠す前の computed opacity を media-plane report に使い、host 側の video は
object の CSS を複製せず、報告された `getBoundingClientRect()` を logical viewport に対する割合へ
変換して配置します。

## プレーヤー操作への pointer 穿透

データ放送 iframe は全面が透明でも、一つの不透明な矩形と同じように hit test されます。そのまま
プレーヤーへ重ねると、特に touch device で下の再生 UI がクリックできなくなります。

`AribReceiverHost` は iframe を表示専用の application plane として扱い、既定で `inert`、
`pointer-events: none !important`、`tabindex="-1"` を設定します。`tabindex="-1"` だけでは iframe 内の
document が focus を取得できるため不十分です。`inert` によって子 document 全体を focus と hit test の
対象から外し、下のプレーヤー container へ mouse / touch event と `:hover` を渡します。描画、timer、通信、
media-plane report は継続します。リモコン入力は iframe の focus に頼らず `host.dispatchKey()` で
document へ送ってください。

iframe 内の pointer event を親へ再送する実装は使いません。iframe の event は親 document へ bubble
しないため、再送には座標から対象要素を再決定する処理が必要になり、player controller の click、drag、
pointer capture を壊します。

HTML/iframe には SVG の `pointer-events: painted` に相当する、非透明 pixel だけを hit test する
モードはありません。透明度や root の背景色を見て iframe を `display: none` にすると、debug overlay
以外の application UI や後から表示される画面まで失われるため使用しません。

## Chromium の白い iframe backdrop

Chromium は iframe owner と iframe 内 root の used `color-scheme` が異なる場合、透明 iframe の
代わりに scheme に対応する不透明 backdrop を描画します。dark theme の host に、標準の light
canvas を使う放送ページを埋め込むと白になります。

この白は DOM の背景ではないため、次をすべて確認しても残ります。

- iframe、`html`、`body` の computed `background-color` が透明
- 背景画像と疑似要素がない
- iframe の `opacity` や `z-index` を変更した

この判定を無効化する公開 feature flag はありません。receiver が管理する iframe owner と
放送ページ root の双方に同じ scheme を明示します。

```ts
iframe.style.colorScheme = 'only light'
iframe.contentDocument.documentElement.style.setProperty('color-scheme', 'only light', 'important')
```

これは clickjacking/XSS 対策による透明 iframe の禁止ではありません。Blink は owner と embedded
document の scheme が異なる場合に canvas backdrop を意図的に描画しています。

## application background と media hole

external adapter は video を iframe の背後に置くため、application canvas の `html` / `body` を
透明化します。ただし元の stage 背景色まで捨てると、映像領域外に host アプリの背景が露出します。
runtime は透明化前の stage 色を host へ報告し、host はその色を z=0 の receiver background plane
へ置きます。`body` が白でも `#backscreen` のような不透明要素が application canvas 全体を覆う場合は、
その全画布要素を実際の stage 色として優先します。色を取得できない間の実装 fallback は黒です。

iframe 内では、media object 自身を透明にしても、その祖先や object より前にある装飾用背景要素が
同じ矩形を塗ると外部 video を隠します。external runtime は次の背景だけを一時的に透明化します。

- media object の不透明な祖先背景
- media object の矩形全体を覆う application element の不透明な背景

要素自体は削除せず、`background-color` と `background-image` だけを退避して透明化します。
media object が消える、ページが遷移する、または application が終了すると元の inline style を
復元します。要素内の文字、画像、字幕、ダイアログ、操作 UI は削除せず、透明な debug overlay
も変更しません。media slot 全体を覆わないボタンやパネルの背景も対象外です。

runtime が一度透明化した背景要素は、media slot を覆っている間は管理対象として保持します。
透明化後の computed style だけを見て対象外にすると、MutationObserver の各走査で
「透明化 → 元へ復元」を繰り返し、映像面と application 背景が点滅します。

## DevTools での切り分け

白い全面シートでは、まず owner/root の scheme を確認します。

```js
const frame = document.querySelector('iframe.dplayer-tlv-data-broadcast')
console.table({
  owner: getComputedStyle(frame).colorScheme,
  root: getComputedStyle(frame.contentDocument.documentElement).colorScheme,
})
```

黒い media slot では、video の `readyState` と矩形を確認した後、iframe 内で media object より前に
ある covering element の背景を確認します。DevTools の青い半透明表示は選択要素の highlight で、
実際の video frame や application background ではありません。
