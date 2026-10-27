export type ChangelogEntry = {
  date: string;
  zh: string[];
  en: string[];
  ja: string[];
};

export const CHANGELOG_PAGE_SIZE = 5;

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026/09/25",
    zh: [
      "新增 Telegram JSON 聊天紀錄匯入與解析支援。",
      "新增 Telegram 匯入指引。",
      "移除聊天紀錄匯入的檔案大小限制。",
    ],
    ja: ["TelegramのJSON形式のトーク履歴に対応しました。","Telegramの取り込み手順を追加しました。","チャットファイルのサイズ制限を解除しました。"],
    en: [
      "Added support for importing and parsing Telegram JSON chat exports.",
      "Added a Telegram import guide.",
      "Removed the file size limit for chat imports.",
    ],
  },
  {
    date: "2026/09/04",
    zh: [
      "修正 LINE 文字檔案解析錯誤問題。",
      "修正儀表板分享會一直停在產生中的問題。",
      "匯入指引改為回到首頁。",
    ],
    ja: ["LINEのテキストファイル解析の不具合を修正しました。","ダッシュボード画像の共有が終わらない問題を修正しました。","取り込み手順からトップ画面に戻れるようにしました。"],
    en: [
      "Fixed LINE text-file parsing errors.",
      "Fixed dashboard sharing getting stuck while generating the image.",
      "Import guides now return to the homepage.",
    ],
  },
  {
    date: "2026/08/28",
    zh: [
      "實作 Meta json 檔 parser (支援中英文)。",
      "新增匯入檔案確認畫面。",
      "正式上線。",
    ],
    ja: ["MetaのJSONファイル解析に対応しました。","ファイルの読み込み確認画面を追加しました。","Webサイトを公開しました。"],
    en: [
      "Added a Meta JSON file parser (Chinese and English).",
      "Added an import confirmation screen.",
      "Launched the site.",
    ],
  },
  {
    date: "2026/08/26",
    zh: [
      "新增 Meta 匯入指引。",
      "優化圖表互動。",
    ],
    ja: ["Metaの取り込み手順を追加しました。","グラフの操作性を改善しました。"],
    en: [
      "Added a Meta import guide.",
      "Improved chart interactions.",
    ],
  },
  {
    date: "2026/08/23",
    zh: [
      "新增文字雲。",
      "聊天室瀏覽網址改為可點擊的小卡。",
      "新增更新日誌分頁。",
    ],
    ja: ["ワードクラウドを追加しました。","トーク内のURLをタップできるカードにしました。","更新履歴をページ分割しました。"],
    en: [
      "Added a word cloud.",
      "Turned chat URLs into tappable link cards.",
      "Added changelog pagination.",
    ],
  },
  {
    date: "2026/08/19",
    zh: [
      "新增側邊聊天室瀏覽。",
      "新增 LINE 匯入指引。",
      "修正 LINE parser 無法處理跨行訊息問題。",
    ],
    ja: ["サイドパネルでトークを閲覧できるようにしました。","LINEの取り込み手順を追加しました。","LINEの複数行メッセージが欠落する問題を修正しました。"],
    en: [
      "Added a side chat panel for browsing messages.",
      "Added a LINE import guide.",
      "Fixed the LINE parser dropping multi-line messages.",
    ],
  },
  {
    date: "2026/08/15",
    zh: [
      "新增儀表板分享功能。",
      "優化儀表板畫面配置。",
      "訊息量比較改為圓餅圖搭配表格。",
    ],
    ja: ["ダッシュボードの共有機能を追加しました。","画面レイアウトを改善しました。","送信数の比較をドーナツグラフと表に変更しました。"],
    en: [
      "Added dashboard sharing.",
      "Improved the dashboard layout.",
      "Redesigned the message comparison with a donut chart and table.",
    ],
  },
  {
    date: "2026/08/10",
    zh: [
      "優化 heatmap 互動動畫。",
      "實作 LINE 文字檔 parser（支援中英文）。",
      "新增訊息量統計，支援每週／每月／每年。",
    ],
    ja: ["ヒートマップの操作とアニメーションを改善しました。","LINEのテキスト履歴に対応しました。","メッセージ数を週別・月別・年別に表示できるようにしました。"],
    en: [
      "Improved heatmap interaction and animation.",
      "Added a LINE text-file parser (Chinese and English).",
      "Added message volume stats by week, month, and year.",
    ],
  },
  {
    date: "2026/08/5",
    zh: ["新增語言切換功能。", "新增常見問題。"],
    ja: ["言語切り替えを追加しました。","よくある質問を追加しました。"],
    en: ["Added language switching.", "Added a Q&A section."],
  },
  {
    date: "2026/07/29",
    zh: ["完成初版首頁及儀表板。"],
    ja: ["トップ画面とダッシュボードの初期版を作成しました。"],
    en: ["Shipped the first version of the homepage and dashboard."],
  },
];
