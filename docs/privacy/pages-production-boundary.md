# GitHub Pages 公開境界（本番と検証ブランチ）

GitHub Pages はこのリポジトリに **1つの公開URL** を持つ。
Actions の deployment environment を `github-pages` 以外にしても、
`actions/deploy-pages` を実行すれば同じ公開URLの内容が置き換わり得る。
**ブランチごとに独立した Pages サイトになるわけではない。**

## リリース規則

- GitHub Pages への公開操作（`actions/deploy-pages`）は `main` の `.github/workflows/pages.yml` のみに許可する。
- Draft PR / 機能ブランチは、`npm test`、ビルド、合成データによる安全監査などの**非公開CI検証**に限定し、Pagesへ配置しない。
- 将来プレビューを公開したい場合は、別リポジトリ・独立したURL・独立した公開設定を用意し、データがすべて合成であることを確認する。
- GitHub、Actions、公開サイトに実チャットログ・元の名前対応表・秘密鍵を含めない。
- `main` に追加する内容はPRレビューとCIで検証し、外部共有を扱う機能は人間が4ファイルを確認する安全ゲートを通す。

2026-10-28: 開発ブランチが別environmentから同一Pages URLに配信できることを検出。
開発ブランチのページ公開ワークフローをmain専用の定義に修正した。
本書自体は安全境界の記録であり、観察者モードの公開承認を意味しない。
