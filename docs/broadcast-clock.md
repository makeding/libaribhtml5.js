# 録画再生時の放送時計

データ放送アプリケーションは現在時刻を `new Date()` / `Date.now()` で取得します。
録画再生でブラウザのシステム時計をそのまま返すと、録画当時ではなく再生日の日時が表示されます。

`AribReceiverHost.setBroadcastClock()` へ、放送時刻とメディア時刻の対応点を渡してください。
runtime は子 iframe に限って、引数なしの `new Date()`、`Date()`、`Date.now()` をこの時計へ
置き換えます。`new Date(value)`、`Date.parse()`、`Date.UTC()` は通常の JavaScript と同じです。

## tlvdemux WASM との接続

tlvdemux の `onBroadcastClock` は NTP epoch の絶対時刻と、それに対応するメディア時刻を返します。

```js
const NTP_UNIX_EPOCH_SECONDS = 2208988800;

onBroadcastClock(clock) {
  const epochMilliseconds =
    Number(clock.broadcastTimeValue) * 1000 /
      Number(clock.broadcastTimeTimescale) -
    NTP_UNIX_EPOCH_SECONDS * 1000;

  const mediaTimeSeconds =
    Number(clock.mediaTimeValue) / Number(clock.mediaTimeTimescale);

  host.setBroadcastClock({
    epochMilliseconds,
    mediaTimeSeconds,
    currentMediaTimeSeconds: () => video.currentTime,
  });
}
```

runtime が返す時刻は次の式になります。

```text
録画内の現在時刻
= epochMilliseconds
 + (video.currentTime - mediaTimeSeconds) * 1000
```

このため、pause 中は時計も停止し、倍速再生では同じ倍率で進み、seek 後は移動先の放送時刻へ
追従します。新しい入力またはチャンネルへ切り替える時は `host.clearBroadcastClock()` を呼びます。

NTP の値がまだ得られていない場合、`getBroadcastTime()` と子 iframe の Date はシステム時刻へ
フォールバックします。録画ファイルの更新日やファイル名から日時を推測しないでください。

## 絶対時刻だけを持つ場合

メディア timeline がない入力では、受信した絶対時刻から通常速度で進む時計も設定できます。

```ts
host.setBroadcastTime(new Date('2026-07-01T12:00:00+09:00'))
```

この形式は pause、再生倍率、seek には追従しません。録画プレーヤーでは
`setBroadcastClock()` と `currentMediaTimeSeconds` を使用してください。
