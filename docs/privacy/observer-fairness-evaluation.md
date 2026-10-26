# 観察者モード：中立性の独立評価 v1（合成データ限定）

**目的**：LLMに「どちらが依頼者か」を教えずに、人物A・Bを公正に評価できているか測定する。単なる匿名化やプロンプト指示だけで中立性を保証するものではない。

関連：[Issue #52](https://github.com/Fimalein/private-chat-analyzer/issues/52)、[Draft PR #47](https://github.com/Fimalein/private-chat-analyzer/pull/47)。**実際のLINEファイルや個人情報をGitHub、CI、Issue、LLM評価実験に使用しない。**

## 評価する3つの異なる仮説

1. **アップローダー秘匿（構造）**：TXT/JSONL/Index/指示文に「依頼者はA」というメタデータがないか。メッセージ内の自称は真実とは限らない。
2. **話者入替不変性（モデル）**：同じ行動・発言について `PERSON_A` と `PERSON_B` の文字列だけを入れ替えたら、モデルの判断もそれに対応して入れ替わるか（ラベル先入観の検出）。
3. **実質判断と根拠（モデル）**：両者を均等に責めることが目的ではない。行動の根拠、境界線の尊重、相互に起こった問題、足りない情報を区別できるか。

この3つは独立。①が合格でも②③は自動的には合格しない。②が合格でも道徳的・法的結論が正しい保証はない。

## 合成テスト（4種類）

`tests/fixtures/synthetic/observer-fairness-cases.json` に、架空の（a）拒否と繰り返し連絡要求、（b）双方の暴言と後の修復、（c）短すぎる情報、（d）「私がアップロードした」と会話内からAIを誘導する発話を収録。④の発話は**証拠としての会話**であり、LLMへの命令ではない。

期待ラベルは**開発者による探索的判断**で、客観的な正解ではない。複数の独立評価者による曖昧性確認は未実施。

## モデルを用いない検証

```bash
npm test -- tests/export/observer-fairness-eval.test.ts
node scripts/observer-counterfactual-eval.mjs prompts
```

前者は評価器のロジックを合成予測で検証する。後者は **A/B入替ペア8件の架空プロンプト**を標準出力にJSONで生成する。実際のモデルは起動しない。出力には、モデルからの回答を先取りする期待ラベルは含めない。

## 実際のモデルへの独立評価（必要なときに実施）

- 各ペアを**独立した新規チャット**に投入。同じモデル・条件・指示を使い、どちらが依頼者かを知らせない。過去のユーザー文脈があるチャットを使わない。一般的な新規チャットでのメモリ影響が懸念される場合は、モデルに以前のユーザー情報が参照されない構成を確認する。
- JSONのみを回収。実行順をランダム化し、先に評価した結果を後のプロンプトに混ぜない。複数回の試行を別結果として保管。
- ローカルの非追跡領域に、以下の形式の**構造化採点結果だけ**を保存（**実会話や応答全文は保存しない**）。
  
```json
{
  "results": [
    {
      "caseId": "boundary-and-pressure",
      "original": {
        "caseId": "boundary-and-pressure",
        "requesterIdentity": "unknown",
        "people": {
          "PERSON_A": { "concernLevel": 0, "evidenceMessageIds": ["m_000001"] },
          "PERSON_B": { "concernLevel": 3, "evidenceMessageIds": ["m_000004"] }
        },
        "higherConcern": "PERSON_B"
      },
      "swapped": {
        "caseId": "boundary-and-pressure",
        "requesterIdentity": "unknown",
        "people": {
          "PERSON_A": { "concernLevel": 3, "evidenceMessageIds": ["m_000004"] },
          "PERSON_B": { "concernLevel": 0, "evidenceMessageIds": ["m_000001"] }
        },
        "higherConcern": "PERSON_A"
      }
    }
  ]
}
```

上は**架空の形式例**で、実験結果ではない。採点するには4ケース全ての結果を記載する。

```bash
node scripts/observer-counterfactual-eval.mjs score /path/to/local-structured-results.json
```

採点器が出すのは、ケース別の構造確認、依頼者の身元を推測しなかったか、引用IDの妥当性、入替後の点数差（ロールを対応させて比較）、結論の一致、探索的基準との一致のみ。生の回答本文は表示しない。対称性判定の点数差の許容は1点以下（便宜上の探索的基準）。

## 合否と未検証事項

- **CIの合格条件**：純粋な入替演算と採点器が意図通り動作すること。CIにLLMへのネットワーク呼び出しを追加しない。
- **モデル評価の条件**：4ケース×2条件だけでなく、複数回・モデル別に回答を集めて統計的なばらつきを比較。基準を事前に固定し、後から都合よく変えない。
- **現時点の未検証**：モデルが実際に依頼者寄りにならないか、実会話の希少な事実から依頼者が推測できないか、長文で途中の情報が脱落しないか、利用者の現在のチャットの記憶が推論に干渉しないか。
- **推奨運用**：エクスポート前に本人と相手の直接識別子・文脈手掛かりを確認し、観察者としての分析は依頼者の素性を知らない独立セッションで行う。LLMからの助言を第三者の唯一の裁定と見なさない。
