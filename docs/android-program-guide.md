# Android の「放送予定」と番組表連携

## 受信機所有の EPG へ渡す

「放送予定」は放送 HTML 内へ任意の番組表 URL を開く操作ではなく、受信機が所有する
番組詳細・予約 UI へ番組識別子を渡す host operation として扱います。

現在時刻と番組の開始・終了時刻から `live` / `future` を判定し、放送種別、network ID、
service ID、event ID を receiver bridge へ渡します。受信機側は識別子を現在の EIT/EPG と
照合してから、自アプリ内の画面を開いてください。放送 application から渡された URL を
そのまま WebView や外部 Activity へ転送してはいけません。

ARIB STD-B62 Volume 2 の `receiverDevice.scheduleToTune()` 等の視聴・録画予約 API と、
この host 固有の番組表画面を開く操作は別のインターフェースです。

## libaribhtml5 のホストインターフェース

プレーヤー側は `AribReceiverHost` の `onOpenProgramGuide` で、WebView または
ネイティブの番組表へ接続できます。SDK は任意 URL を受け取らず、番組情報だけを渡します。

```ts
const host = new ARIBHTML5.AribReceiverHost({
  iframe,
  viewport,
  onOpenProgramGuide(request) {
    const bridge = window.ARIBNative
    if (!bridge?.openProgramGuide) return false

    bridge.openProgramGuide(JSON.stringify(request))
  },
})

await host.openProgramGuide({
  destination: 'program-detail',
  state: 'future',
  program: {
    original_network_id: 4,
    tlv_stream_id: 1,
    service_id: 101,
    event_id: 42,
  },
})
```

Android 側では JSON 内の識別子を検証したうえで、自アプリの番組詳細 Activity を開きます。
URL を JSON からそのままロードしてはいけません。

`onOpenProgramGuide` が未設定、`false` を返す、または例外を送出した場合、SDK は
`false` を返して次の標準メッセージを表示します。

- 番組詳細: `このプレーヤーでは放送予定の番組詳細を表示できません。`
- 番組表: `このプレーヤーでは番組表を表示できません。`

独自のダイアログや toast を使う場合は `onProgramGuideUnavailable` を指定します。

```ts
const host = new ARIBHTML5.AribReceiverHost({
  iframe,
  viewport,
  onProgramGuideUnavailable({ request, reason, error }) {
    showPlayerNotice({ request, reason, error })
  },
})
```
