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

### future 判定と検索データ

`ProgramInfoOpenHelper` の判定は単純な派生状態です。番組時刻は DB 内では秒単位で、
比較時にミリ秒へ変換されます。

```text
now >= start + duration  -> 検索結果に入れない
start <= now < end       -> live
now < start              -> future（最大 50 件）
```

future の `suggest_text_1` は `[放送予定] 番組名` になります。同じ放送種別、
service ID、event ID の有効な予約があれば `[予約済]` も追加されます。
`suggest_intent_extra_data` には番組 JSON と `#future`、live の場合は `#live` が入り、
クリック後の `TvTunerService` はこの suffix で遷移を分けます。

Provider は次の標準 suggestion 列を公開します。

- `suggest_text_1` / `suggest_text_2`
- `suggest_result_card_image`（ジャンル別 320 x 180 画像）
- `suggest_is_live`
- `suggest_intent_extra_data`
- `suggest_intent_data_id`

Katniss 側のローカル suggestion 変換では、タイトル、説明、カード画像、intent extra data
をそのまま読み、`suggest_is_live` 自体では分岐していません。したがって、この機種で
future を決定している本体は `ProgramInfoOpenHelper` と `#future` の受け側です。

また、APK の日本語リソースに存在する原文は `[放送予定]` で、括弧なしの
`放送予定` という独立した文字列リソースは見つかりません。スクリーンショットの括弧なし
表示は検索 UI 側のプレゼンテーションであり、放送 HTML やフォントが生成する状態では
ありません。

### EPG の保存と更新

検索時に放送波を直接スキャンしているわけではありません。ネイティブチューナーが持つ
`program_info.sqlite3` の更新時刻を監視し、検索用の `program_info.db` へコピーします。
検索要求ごとに一時 `suggest_content.db` を作り直し、番組名・説明とチャンネル名を検索します。

バックグラウンド更新は起動後 5 分、その後 30 分ごとに判定されます。EPG スキャンを
実行する JST の時間帯はコード上で次の二つです。

- 04:38–07:37
- 16:38–19:37

更新サービスは `StartMode.UpdateEPG` でチューナーを初期化し、EPG cache target `0` を
更新して最大 120 秒待ちます。録画対応機では録画コンテンツ target `5` と予約 target `6`
も更新します。テレビアプリが前面へ出た場合、バックグラウンド更新は中止されます。

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
