# Android の「放送予定」と番組表連携

## Android ファームウェアで確認できた処理

「放送予定」は放送 HTML 内のページではなく、受信機が所有する EPG 機能です。
SMB400 rev24.24 では次の経路になっています。

1. `ProgramInfoProvider` がチューナーの `program_info.sqlite3` を検索用 DB へ同期する。
2. `ProgramInfoOpenHelper` が現在時刻と番組の開始・終了時刻を比較する。
   放送中は `live`、開始前は `future` とし、future の検索タイトルへ
   `[放送予定]` を付ける。
3. Android TV の検索結果を選ぶと `SearchableProgramInfo` が
   `TvTunerService` を起動し、番組情報と `future` を渡す。
4. `TvTunerService` は future の場合に `StartMode.Reserve` を選び、別パッケージの
   `jp.pixela.atv_app.MainActivity` を起動する。
5. その Activity の WebView は次の内蔵ページを開く。

```text
file:///android_asset/programList/index.html?ts=...
  #/?program_id=...&broadcast_type=...&service_id=...&event_id=...
```

したがって、これは任意の外部 URL を開く機能ではありません。検索結果から受信機所有の
番組詳細・予約 UI へ移る、明示的なホスト機能です。

なお、ARIB STD-B62 Volume 2 には `receiverDevice.scheduleToTune()` などの
視聴・録画予約 API もありますが、上記の Android 検索結果から番組詳細を開く処理とは
別のインターフェースです。

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
