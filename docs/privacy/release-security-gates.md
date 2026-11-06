# リリース時のセキュリティ境界（2026-11-06）

## この変更が自動的に強制すること

- `.github/workflows/pages.yml` は `main` のみで公開する。
- ビルドジョブは `contents: read` に限定し、`pages: write` / `id-token: write` は公開ジョブだけに与える。
- 実際の Pages 用ビルド成果物が、`privacy:guard`、`npm test`、本番依存の `npm audit --omit=dev --audit-level=high`、合成LINEチャットのChromium通信監査を通るまで、成果物をPagesへ渡さない。
- 通信監査は合成メッセージの読み込み、プライバシー確認、ZIPダウンロード、メッセージ検索を行い、オリジン外HTTP、WebSocket、ネットワークへ出た合成canaryを検知する。実チャット履歴は使わず、URL・ヘッダー・本文はログに表示しない。
- PRでは `.github/workflows/security-egress.yml` で同じ合成ブラウザ監査を実行する。

これらは**特定経路の回帰検査**であり、依存関係にバックドアがないことや、全ての匿名化が成功すること、端末・拡張機能・CDN・外部共有先の動作まで証明しない。静的に解析できるソースと、GitHub Pagesで実際に配信されたビルドの一致は、公開URLで別途検証する。

## GitHub設定で必須の手作業

GitHub接続の現行書込みアクションではRulesets/Branch protectionを直接設定できないので、以下をGitHub UIで設定する。

1. `Settings → Rules → Rulesets`（または `Settings → Branches`）で `main` の直接push、強制push、ブランチ削除を制限する。
2. PRを必須にし、ステータスチェック **`Test and build`** と **`Privacy browser egress`** を必須にする。チェック名は実際に成功したworkflow runの一覧から選ぶ。
3. 可能なら独立したレビュアーの承認を必須にし、古い承認を無効化する。公開用の `.github/workflows/**` 変更にもコードオーナー承認を適用する。
4. `Settings → Environments → github-pages` のdeployment branchesを `main` に限定する。GitHub Pagesの公開元がGitHub Actionsになっていることを確認する。
5. 権限が必要なジョブのみ権限を持つことを維持する。将来的にサードパーティActionsの参照を検証済みの**フルコミットSHA**へ固定する。
6. リリース時はPR差分、package-lock、チェック結果と公開サイトのHTTP・ネットワーク挙動を確認する。

## なお残るリスク

- `npm ci` は依存パッケージのライフサイクルスクリプトを実行し得る。ビルドは権限を絞ったGitHub-hosted runnerに置き、依存関係更新をレビューする。
- Chromeの拡張機能やOSの共有機能の挙動は本監査の対象外。
- リンクのクリック先、実ファイルの外部共有、すべての匿名化パターン、悪意あるトークン埋め込みの全バリエーションは対象外。
- 現在の `npm run lint` はベースライン上の未解決警告があり、全リリースを止めるゲートにはまだしていない。別Issueで解消し、解消後に必須化する。
- 未マージのPR #47のブラウザ監査は独立の補助検査。本番用 `main` に未承認機能を無断で統合しない。

このファイルは、合成入力だけを使った検証を前提としている。実チャット内容・生の識別子・仮名対応表をIssue/PR/Actions/artifactへ記録しないこと。
