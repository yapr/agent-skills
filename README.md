# agent-skills

開発・自動化に使う、再利用可能なエージェント向けSkill集です。

## 状態と導入

初期実装はレビュー待ちです。配置は `skills/<skill-name>/SKILL.md` です。
初期PRのマージ後、プロジェクト内で実行してください。

```sh
npx skills add yapr/agent-skills --skill build-in-public -a codex
```

このコマンドはマージ後の例で、mainからの導入は未検証です。導入前にSkillを確認してください。[公式CLI](https://github.com/vercel-labs/skills)は既定でプロジェクト内に導入します。全体へ導入する場合だけ `-g` を指定します。

ローカルの確認には、一時プロジェクトで次を使います。

```sh
npx skills@1.7.4 add /absolute/path/to/agent-skills --skill build-in-public -a codex -y
```

検証済みなのはCodex用ファイルの導入です。エージェントの実動作やClaude Code対応は未検証です。

## Skill

| Skill | 用途 |
| --- | --- |
| [build-in-public](skills/build-in-public/SKILL.md) | 指定した開発履歴から、事実と機密情報を確認した公開用の下書きを作る。投稿はしない。 |
| [activity-report](skills/activity-report/SKILL.md) | GitHubの作業報告・年表を図解し、確認後にSlackへ送る。[導入手順](skills/activity-report/README.md) |
| [ship-project](skills/ship-project/SKILL.md) | リリース前の根拠と残件を整理する。公開操作はしない。 |

## 利用・貢献

対象範囲と読者を指定して、エージェントに `build-in-public` の使用を依頼してください。Skillはアクセス権や実行許可を与えません。リポジトリのルールと実行環境の権限に従います。

変更は通常PRで提案し、具体例・主張の根拠・検証結果・制約を添えてください。認証情報、非公開URL、顧客情報、内部運用コード、非公開資料の転載は含めません。自動投稿・デプロイは対象外です。

## ライセンス

MITは提案段階で、未採用です。LICENSEによる利用許諾はまだありません。オープンソースとしての再利用を案内する前に、管理者のライセンス判断が必要です。公開されているだけでは再利用の許可にはなりません。
