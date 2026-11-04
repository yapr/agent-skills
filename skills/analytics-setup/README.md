# analytics-setup

GTM経由のGA4導入を、棚卸し → 計画 → 承認済みの設定 → 検証に分けて進めるSkillです。1コマンドで本番設定を完了するCLIではありません。

## 導入・例

マージ後、対象プロジェクトで:

```sh
npx skills add yapr/agent-skills --skill analytics-setup -a claude-code
```

PR確認中はソースを `'https://github.com/yapr/agent-skills#dot/analytics-setup'` に置き換えます。Codexは `-a codex`。Python 3.10以上が必要です。

- 「このNext.jsサイトのアナリティクスをセットアップして。まず計画だけ」
- 「既存WordPressのGA4をGTM経由にしたい。二重計測を確認して」

Skillフォルダで実行:

```sh
python3 scripts/plan.py --input example.json --dry-run
python3 -m unittest discover -s tests -v
```

サンプルは架空で、認証不足の案内になります。補助ツールは入力JSONの整合性と再利用方針を検査するだけです。ネットワーク接続・トークン読取・ファイル変更・Google設定変更はありません。`--apply` はありません。

## 棚卸し入力

`example.json` を私用の作業場所へコピーし、実測した情報だけを記録します。raw API応答や認証情報は渡しません。未定義キーは拒否し、エラーにも入力値を出しません。

- `target`: URL、`framework`、対象のGA4/GTMアカウントID。
- `inventory.status`: `verified` は対象の全ページ・サイト挿入元を確認済みの場合だけ。他は `credentials_missing` / `unknown` / `partial` / `failed`。
- verifiedでは `url` と両アカウントIDを対象と一致させ、次の一覧・真偽値を必須とします。

| キー | 対象サイトに紐付く棚卸し結果 |
| --- | --- |
| `measurement_ids` | 確認したWeb Streamの `G-...` 候補 |
| `gtm_ids` | 確認したWeb Containerの `GTM-...` 候補 |
| `google_tag_measurements` | 選択WorkspaceのGoogle tag / destinationが送信する測定ID |
| `site_gtm_ids` | ページの独立した挿入元ごとのGTM ID。同じIDの二重挿入も2件で記録 |
| `direct_ga4_ids` | GTM以外の直接GA4。なければ空配列 |
| `plugin_unreviewed` | プラグイン等に未確認の挿入元があるか |
| `consent_reviewed` | CMP・同意拒否/許可・送信項目の方針を確認したか |

`framework`: `next-app` / `next-pages` / `wordpress` / `go` / `static`。自動判定で上書きしません。詳細なProperty・Stream・ContainerのAPI IDや根拠は私用台帳へ保持し、測定IDだけで変更対象を選ばないでください。

出力は `needs_review`（停止・確認）、`plan_ready`（未実行の提案）、`reuse_only`（追加不要）。`verification` は常に未検証です。同じ入力で同じ計画になり、何度実行しても設定を作りません。ライブAPIでの冪等性を実証したものではありません。

## 制約

認証・全ページの収集・Google側の実行はエージェントの接続ツールまたは管理画面が必要です。この会話の接続をClaude Code等でも使えるとは仮定しません。既存候補CLIを自動インストール・実行しません。実Google API・実サイトへのE2Eは未検証。MITは未決定のままです。
