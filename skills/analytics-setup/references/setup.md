# 実行と検証

## 読取と権限

最初は既存認証の読取だけ。GA4は `analytics.readonly`、GTMは `tagmanager.readonly` を基本にする。OAuth scopeだけでなく、対象製品・アカウントのロールも必要。認証不足なら必要な対象と権限を説明して本人の対応を待ち、鍵作成・API有効化・OAuth同意・共有権限変更を代行しない。

承認済みのGA4作成/更新には `analytics.edit`、GTMタグ編集には `tagmanager.edit.containers`、バージョン作成には `tagmanager.edit.containerversions`、公開には `tagmanager.publish` 等、**実際のmethodが要求する権限だけ**確認する。公開権限を計画段階で取得しない。トークンは接続ツールの秘密管理を使い、設定例・標準出力・PRに含めない。

## 再利用と差分

1. GA4の対象アカウント→Property→Web Streamを列挙し、API ID・defaultUri・測定IDを照合。GTMは対象アカウント→Web Container→Workspace→タグ・トリガー・変数・destinationを確認する。ページトークンが尽きるまで取得し、rate limitや途中失敗は未完了とする。
2. 直接gtag、GTM、GoogleAnalytics、CMS挿入、CMP、独自dataLayer名を確認。HTML検索だけで「なし」としない。hydration後、同意前後、複数ルートでDOM・通信を調べる。
3. 既存StreamがあるならPropertyを新設しない。既存Container/Workspaceを再利用し、現在のGoogle tagまたはAnalytics destinationが目的の測定先へ接続済みなら追加しない。トリガー名だけで同一判断せず、測定先・条件・同意・発火回数を比較する。
4. Google側を変更する場合は対象path・差分・fingerprintをレビューする。Workspaceの他者変更を含む公開はしない。競合を上書きせず、結果不明時は再読取して同一リソースを確認する。自動再作成・自動削除は禁止。

## プライバシーと既定値

広告連携、User-ID、独自イベントは追加しない。拡張計測も既存設定を確認し、フォーム入力・検索語・URL/query・ページタイトルに個人情報が入らないことを調べる。不要な送信や機密URLは収集前に抑止する。

CMPと同意方針が未確定なら設置案まで。提案の既定は同意前の計測タグを読み込まないbasic方式で、advancedのcookieless送信を黙って有効にしない。denied設定だけで通信がゼロになるとは説明しない。Consent InitializationとCMP更新を計測タグより先に処理し、同意状態を偽装しない。noscript iframeも同意方針を迂回しないことを確認する。

## サイト別

| 対象 | 設置・移行の確認 |
| --- | --- |
| Next.js App | 現行版と既存実装を確認し、root layoutの1か所に `GoogleTagManager` 等の案。直接 `GoogleAnalytics` と併用しない |
| Next.js Pages | `_app` の1か所で共通化。App/Pages混在なら両方からの重複を確認 |
| WordPress | Site Kit・GTM挿入プラグイン・テーマ・CMP・キャッシュを棚卸し。1つの管理元を選び、旧方式停止と新方式切替を同じ承認済み移行計画にする |
| Go / 静的 | 共通HTMLテンプレートのhead/bodyへ管理画面の公式スニペットを使う。ページ固有テンプレートとの二重挿入、CSP nonceを確認 |

Next.js等のSPAは初回ロードとルート遷移を別検証する。自動履歴計測と手動 `page_view` を重ねない。依存更新・プラグイン導入は勝手に行わずPR/手順にする。設置しただけで本番deploy済みとは扱わない。

## 検証と公開ゲート

テスト環境・データを明示し、Tag Assistant PreviewでGoogle tagの測定先、CMP既定/更新、1ページ遷移あたりの発火・ネットワークを確認する。同意拒否、許可、撤回、初回、SPA遷移を含める。test送信も許可された測定先だけ。

検証端末だけdebug modeを有効にし、GA4 DebugView/Realtimeで対象Stream・時刻・イベントを照合。単なるScript読込やHTTP成功はGA4受信確認ではない。反映遅延・ブロッカー等で見えなければ未確認とする。DebugViewに個人情報を送らない。

`create_version` はWorkspaceの状態も変えるため単なる読取ではない。承認後にのみ実行し、compilerError・syncStatus・newWorkspacePathを確認する。

公開するversion・含まれる全変更・対象環境・復旧手順を提示し、GTM公開とサイトdeployをそれぞれ承認待ちにする。承認後も設置／公開version／GA4受信を別々に記録する。台帳のID契約はGA4 account/property/stream/measurement ID、GTM account/container/public ID、workspace/version、検証時刻・根拠。秘密は含めない。

## 公式参照（実行時に再確認）

- [Google tag / Analytics destinationとPreview](https://support.google.com/tagmanager/answer/9442095)
- [GTM APIと対象リソース](https://developers.google.com/tag-platform/tag-manager/api/v2)、[認可](https://developers.google.com/tag-platform/tag-manager/api/v2/authorization)、[タグ作成](https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.containers.workspaces.tags/create)
- [GA4 Stream一覧・ページング](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties.dataStreams/list)
- [DebugView](https://support.google.com/analytics/answer/7201382)
- [バージョン作成の副作用](https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.containers.workspaces/create_version)
- [Consent mode](https://developers.google.com/tag-platform/security/guides/consent)
- [Next.js App](https://nextjs.org/docs/app/guides/third-party-libraries)、[Pages](https://nextjs.org/docs/pages/guides/third-party-libraries)

候補CLI [google-site-setup](https://github.com/eugene-bear/google-site-setup) は公開README上でprovisionにGTM公開を含み、CMP設定は対象外。採用・実行はしていない。独自Skillやコードは転用せず、将来の評価でも公開しないモード・権限・冪等性を先に検証する。
