# MH-AIT アプリケーションライフサイクル

この文書は、ARIB HTML5 データ放送の自動起動、表示用アプリケーションへの切替、終了、
および EMT の責務境界を receiver host 向けにまとめます。放送局固有の URL や EMT ID を
プレーヤーへハードコードしないための実装条件です。

## 制御の所有者

アプリケーションの起動と終了は MH-AIT の application control code が制御します。

| control code | 値 | receiver の動作 |
| --- | ---: | --- |
| `AUTOSTART` | `0x01` | entry resource が利用可能になった時点で自動起動する |
| `PRESENT` | `0x02` | 実行可能として保持する。新しいページを自動起動しない |
| `KILL` | `0x04` | 対象の managed application を直ちに終了する |
| `PREFETCH` | `0x05` | resource を取得・保持する。表示や起動は行わない |

根拠は ARIB STD-B60 1.5版 10.3.3.5 の application control code と、同規格の
`present_application_priority` / `application_priority` の規定です。

`AUTOSTART` は「receiver が iframe を CSS で非表示にする」という意味ではありません。
同じ application slot へ entry document を読み込み、ページ自身が透明な bootstrap として動作します。
表示用ページへ切り替える必要がある場合、実行中のページが
`navigator.applicationManager.getOwnerApplication().replaceApplication(...)` を呼びます。

## replaceApplication

ARIB STD-B62 第二編 3.3.7–3.3.8 は `ApplicationManager` と `Application` を定義します。
`replaceApplication(organization_id, application_id, ait_url)` は現在の application を終了し、
指定した application を起動する受信機要求です。EMT を受信した host が URL を推測する機能ではありません。

`libaribhtml5` はこの要求を `AribReceiverHostOptions.onReplaceApplication` へ渡します。
host は現在の MH-AIT から `(organizationId, applicationId)` を検索し、entry resource の VFS commit を
待ってから、同じ `AribReceiverHost` / iframe で `loadApplication()` を実行してください。

```ts
const host = new AribReceiverHost({
  iframe,
  viewport,
  onReplaceApplication: async request => {
    const target = currentApplications.get(
      `${request.organizationId}:${request.applicationId}`,
    )
    if (!target) throw new Error('Application is not present in the current MH-AIT')
    await vfs.waitFor(target.entryRevision)
    host.setApplicationInformation(target.information)
    host.loadApplication(target.entryUrl, 'アプリケーション切替中')
  },
})
```

`exitFromManagedState(url)` は放送管理外の general application へ移る別の操作です。
許可境界と外部 network policy を receiver 側で検証し、対応する場合だけ
`onExitManagedState` で処理します。

## AUTOSTART と PRESENT の同居

一つの tuning/session generation につき managed application slot は一つにします。

1. active application がない時だけ、ready になった `AUTOSTART` を読み込む。
2. `PRESENT` は data button 用の候補として保持するが、それだけで iframe を reload しない。
3. 同じ application が AUTOSTART から PRESENT へ更新され、継続条件を満たす場合は既存 runtime を再利用する。
4. `KILL`、AIT からの消失、AIT location descriptor の消失、tune/session reset で runtime と listener を破棄する。
5. 404 または runtime bootstrap 不成立が確定した時点で直ちに破棄する。固定の再試行待ち時間中、
   壊れたページを表示し続けない。

application state、resource revision、EMT listener、version deduplication はすべて tuning generation に
所属させます。前チャンネルの非同期完了や event を新しい iframe へ渡してはいけません。

## EMT は起動コマンドではない

ARIB STD-B60 1.5版 11章の Event Message Table は、実行中 application の登録済み selector へ
event message を指定時刻に配送する仕組みです。`time_mode=0` の即時配送だけでなく、UTC/NPT/相対時刻等の
ignition time を receiver clock に従って処理します。

- EMT `40/5` 等を見て host が表示ページ URL を決めない。
- application が listener を登録する前に到着した event を、起動後に独自再生しない。
- 同じ message ID/version は重複配送しない。
- listener 登録後に受信した、または放送側が再送した event だけを application へ渡す。

したがって紅白等の連動ページは、MH-AIT による AUTOSTART、ページ内 listener 登録、EMT 配送、
ページによる `replaceApplication()` の順に進みます。
