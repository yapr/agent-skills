# activity-report

GitHubの作業報告・マージ年表を日本語とPNGで作り、確認後にSlackへ送ります。画像生成APIは使いません。

## 導入

Node.js 22以上と日本語フォントが必要です。Skillのフォルダで実行します。

```sh
npm ci --ignore-scripts
npx playwright install chromium
cp config.example.json config.local.json
```

`config.local.json` に許可repoとデフォルトを設定します。サンプルは架空です。トークンは書き込みません。

| 設定 | 意味 |
| --- | --- |
| `allowedRepos` | 閲覧・集計するrepoの明示一覧。「全体」はこの範囲だけ |
| `scope` | `all` またはカンマ区切りrepo。`--repos` で上書き可能 |
| `period` | `weekly`（前週月曜〜今週月曜）、`three-months`（直前の完了した3暦月）、`custom` |
| `start` / `end` | customの `YYYY-MM-DD`。開始日を含み、終了日を含まない |
| `timezone` | IANA名。例: `Asia/Tokyo` |
| `workspace` / `channel` | SlackのID。表示名から推測しない。生成だけなら未設定可 |
| `format` | `both`（本文＋PNG、既定）、`text`、`png`（PNGと説明文） |

明示引数が設定より優先します。開始・終了日を明示すると `custom` になります。例: 11月2日の3か月集計は8月1日〜11月1日で、90日や暦四半期ではありません。境界はタイムゾーンの現地0時、夏時間も反映します。

## 使い方

自然言語の例:
- 「全体を週次サマリーしてSlackに投げて」→ 設定を使用し、dry-runで内容確認後に送信。
- 「example-org/example-appの8月〜10月を図と年表に。投稿しないで」→ 開始8/1・終了11/1を指定して生成のみ。

```sh
# 生成。毎回、新しい出力フォルダを使う
node scripts/cli.mjs prepare --config config.local.json --out ./reports/week-1
# repo・任意期間を上書き
node scripts/cli.mjs prepare --config config.local.json --repos example-org/example-app --start 2026-08-01 --end 2026-11-01 --out ./reports/period-1
# 投稿せず、報告IDと宛先だけ確認
node scripts/cli.mjs deliver --out ./reports/week-1
```

出力は本文 `report.txt`、図 `report.png`（text指定では省略）、根拠と年表データ `evidence.json`、年表全文 `timeline.md`、整合性確認用 `manifest.json` です。PNGは要点6件以内・年表直近6件、全件はローカルの根拠と年表に残ります。実績ファイルはコミットしません。

要点を整える場合は `[{"text":"根拠に沿う説明","refs":["出典ID"]}]` のJSONを作り、`prepare --highlights highlights.json` で別フォルダへ再生成します。出典IDは `evidence.json` の `events[].id` です。本文だけを書き換えると整合性検査で送信を止めます。宛先・形式の上書きもprepare時に指定し、deliverでは変更しません。

送信は明示依頼と共有範囲の確認後だけ実行します。`REPORT_ID` は生成時のID、`CHANNEL_ID` は確定済みの宛先へ置き換えます。

```sh
node scripts/cli.mjs deliver --out ./reports/week-1 --send --confirm-report REPORT_ID --confirm-channel CHANNEL_ID
```

非公開repoを含む場合は、その宛先での共有承認を確認したうえで `--approve-private` も必要です。Slack参加者やSlack Connectの範囲をCLIは自動判定しません。PNGは本文と同じファイル投稿、text指定は通常メッセージになります。

## 認証・権限

- GitHub: `GITHUB_TOKEN`。公開repoは未設定でも取得可能。非公開repoは対象を限定したfine-grained tokenで Metadata / Issues / Pull requests / Contents のRead権限（ContentsはRelease用）が必要です。
- Slack: `SLACK_BOT_TOKEN`。画像投稿は `files:write`、text形式は追加で `chat:write`。Botは投稿先へ参加済みである必要があります。チャンネル検索や参加者列挙は行わず、追加のread scopeは要求しません。
- workspaceは `auth.test` で照合します。Claude Code等で使う場合も、その実行環境側で認証を用意してください。権限追加・アプリ導入はこのSkillでは実行しません。

[Slack公式SDK](https://docs.slack.dev/tools/node-slack-sdk/web-api/)の `filesUploadV2` を使用します。旧 `files.upload` は使いません。[完了APIの権限](https://docs.slack.dev/reference/methods/files.completeUploadExternal/)は `files:write` です。

## 制約・失敗時

- GitHubはPR・Issue・Releaseの現在の記録を集計します。削除済み記録や再オープン等の全履歴は復元しません。コメント・レビュー数は集計しません。
- [ページング](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api)は一覧ごとに最大100ページ。APIエラー・rate limit・上限超過時は成果物を確定せず停止します。原因解消後に再集計してください。
- 年表は `merged_at` と出典を持ち、本番反映日 `production_at` はnullです。Release記録も本番反映の証拠とはしません。将来用の `production_evidence` / `metric_evidence` は空配列で、GA4連携は未実装です。
- 送信台帳は既定で `~/.local/state/activity-report`。必要なら導入時に `ACTIVITY_REPORT_STATE_DIR` を固定してください。同じ台帳を維持し、複数端末から同じ報告を送らないでください。端末間の重複防止は保証しません。
- SDKの自動再送は無効です。pending / uncertain / sent はすべて再送を止めます。Slackで報告ID・本文・ファイルを確認し、失敗が確定するまで再送しません。途中アップロードのファイルを勝手に削除しません。
- 生成・送信先はローカルの信頼できる設定を使います。設定や成果物を信頼できない相手に変更させないでください。出力は非公開情報を含み得ます。

## 検証

```sh
npm test
node scripts/cli.mjs prepare --config config.example.json --fixture tests/example.json --start 2026-10-26 --end 2026-11-02 --out ./reports/sample
```

テストは架空データとSlackモックのみ。PNGはChromiumで実生成します。fixtureからの送信は拒否します。実Slack送信、実アカウントでの集計、Claude Codeの自然言語発動は未検証です。ライセンスはリポジトリの未決定状態を引き継ぎます。
