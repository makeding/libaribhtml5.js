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

根拠は ARIB STD-B60 1.5版 10.3.2.1 表10-8の application control code と、同規格
10.3.3.1 の MH-application descriptor です。

`AUTOSTART` は起動を指示する control code であり、CSS の表示状態を指示しません。
ユーザーへの可視性は別フィールドである MH-application descriptor の `visibility` で決まります。

| visibility | receiver の動作 |
| ---: | --- |
| `00` | エラー報告等を除き、ユーザーと他 application の双方へ不可視 |
| `01` | ユーザーへ不可視。他 application からは API 等を介して可視 |
| `10` | reserved |
| `11` | ユーザーと他 application の双方へ可視 |

`00` / `01` でも document、timer、通信、EMT listener は実行を続けます。iframe を `display:none`
にして実行を止めず、receiver compositor の application plane だけをユーザーへ合成しません。
`11` の AUTOSTART は通常どおり画面を描画できます。

別 application へ切り替える必要がある場合、実行中のページが
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

## アプリケーション境界と権限

MH-AIT の `MH-Application Boundary and Permission Descriptor` (`descriptor_tag=0x802C`)
は、decoder 側で一つの application に属する loop を平坦化し、次の形で渡します。

```ts
host.setApplicationInformation({
  organizationId: application.organizationId,
  applicationId: application.applicationId,
  permissionManagedAreas: application.boundaryDescriptors.flatMap(descriptor =>
    descriptor.areas.map(area => ({
      // bitmap ID を含む raw 16-bit 値
      permissionBitmaps: area.permissionBitmaps,
      managedUrls: area.managedUrls,
    })),
  ),
})
```

descriptor がない場合は `permissionManagedAreas` 自体を省略します。この場合は境界が無限で
全権限です。descriptor が存在し、ある area の `managed_URL_count` が 0 の場合は
`managedUrls: []`（または `null`）で全 location を表します。より狭い domain/sub-directory の
設定が一致した場合はそちらを優先します。放送 VFS (`broadcastBaseUrl`) から取得した content は、
TR-B39 の規定どおり descriptor にかかわらず境界内・全権限として扱います。

runtime は bitmap 0/1 を解釈し、bit 12/10/9/8/7/5 を現在実装済みの broadcast media、番組情報、
persistent array、boundary extension、receiver ID、application/cache/EMT/system-information API に
適用します。権限がない同期 API は `Error` (`code="NOT_AUTHORIZED_ERR"`) を送出し、AIT 更新後も
同じ runtime に直ちに反映します。更新によって現在の communication document が境界外になった場合、
host は application を終了します。

境界権限と `allowExternalNetwork` は別条件です。MH-AIT が URL を許可しても、host の network policy が
offline なら外部 HTTP へは遷移・通信できません。

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
event message を指定時刻に配送する仕組みです。規格には即時、UTC、NPT、相対時刻等の time mode が
あります。現在の runtime が保証するのは即時配送 (`time_mode=0`) だけであり、その他の ignition time は
receiver clock scheduler を実装するまで未対応です。

- EMT `40/5` 等を見て host が表示ページ URL を決めない。
- application が listener を登録する前に到着した event を、起動後に独自再生しない。
- 同じ message ID/version は重複配送しない。
- listener 登録後に受信した、または放送側が再送した event だけを application へ渡す。

したがって紅白等の連動ページは、MH-AIT による AUTOSTART、ページ内 listener 登録、EMT 配送、
ページによる `replaceApplication()` の順に進みます。
