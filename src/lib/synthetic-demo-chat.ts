// SYNTHETIC_FIXTURE: entirely fictional, locally generated content.
// No user uploads, real conversations, accounts or external requests are involved.
import type { ParsedChat } from "@/lib/chat-types";
import { parseLineChat } from "@/lib/parse/line";

const DAYS: readonly (readonly string[])[] = [
  [
    "来週の予定、何か決まった？", "まだ決めてない。散歩でもどう？", "いいね。雨だったらどうする？",
    "そのとき考えよう", "時間だけ先に決めない？", "午後なら空いてるよ",
    "じゃあ14時くらいで", "待ち合わせは後で相談しよう", "了解！",
    "[スタンプ]", "この前の映画、意外と面白かったね", "最後の展開は読めなかった"
  ],
  [
    "今日、予定が少し押してる", "何時くらいになりそう？",
    "まだ分からない。分かったら連絡する", "それだと外で待つことになりそう",
    "ごめん、先にお店に入っていてもらえる？", "うん。でも次は早めに教えてほしいな",
    "それは本当にそうだね", "急に決まったことだったけど、連絡はできたはず",
    "分かってくれてよかった", "到着した！", "おつかれ。あとで話そう", "ありがとう"
  ],
  [
    "昨日の言い方が少し気になってる", "どの部分？",
    "説明している途中で『大げさ』って言われたところ", "軽い冗談のつもりだった",
    "冗談でも、話を切られたように感じた", "そこまでは考えていなかった",
    "私も言い返し方は強かったと思う", "確かにお互い声が大きくなったね",
    "ただ、嫌だったことはちゃんと聞いてほしい", "分かった。具体的に聞かせて",
    "今日は長文になるかも", "読む時間は取れるよ"
  ],
  [
    "昨日の続きを話していい？", "うん。今なら大丈夫",
    "私が話しているときは、まず最後まで聞いてほしい",
    "途中で結論を急いでたかもしれない", "あと『またその話？』は傷ついた",
    "それはよくなかった。ごめん", "謝ってくれてありがとう",
    "私も冷静に伝えられなかったのは反省してる", "今後どうするのがいいかな",
    "話せないときは『後で何時に話そう』と伝えるのは？",
    "それなら安心できると思う", "まずは試してみよう"
  ],
  [
    "今日ちょっと疲れているので、電話は明日にしたい", "分かったけど少し不安",
    "不安なのは分かる。でも今は休みたい", "何かあった？",
    "仕事のこと。今は詳しく話す余裕がない", "そうなんだ。決めつけてごめん",
    "聞いてくれてありがとう", "明日、都合のいい時間だけ教えて",
    "19時以降なら大丈夫", "じゃあ19時半にしよう", "[写真]", "写真だけ送っておくね"
  ],
  [
    "この間のやり方、意外とよかったね", "後で話す時間を決めるやつ？",
    "そう。焦って何回も聞かなくて済んだ", "私も返信を急がなくてよくなった",
    "ただ、予定変更は早めに連絡してほしい", "それは続けて気をつける",
    "言いたいことを溜めずに話せるといいな", "お互いにね",
    "ところで週末の散歩はどうする？", "晴れなら行こう",
    "持っていく飲み物どうしよう", "好きなのを選ぼう ☕"
  ],
  [
    "昨日考えたこと、少し長く書いてもいい？", "もちろん",
    "相手の気持ちを推測しただけで決めつけないようにしたい。",
    "それは私も同じ。聞かないと分からないことが多い",
    "ただ、境界線を伝えたときには尊重してもらいたい", "その点は気をつける",
    "私も伝え方を工夫する", "言葉の選び方って難しいね",
    "少しずつ慣れていこう", "今日はこの辺で休もう",
    "おやすみ", "おやすみ 🌙"
  ],
];

export const SYNTHETIC_DEMO_FILE_NAME = "SYNTHETIC_FIXTURE_example_chat.txt";

/** Generate an actual LINE-compatible text fixture, then parse it using the real parser. */
export function makeSyntheticDemoLineText(): string {
  const lines = [
    "[LINE] 架空のキイとのトーク履歴",
    "保存日時：2026/10/27 12:00",
    "",
  ];
  DAYS.forEach((contents, dayIndex) => {
    const day = String(3 + dayIndex * 3).padStart(2, "0");
    lines.push(`2026/10/${day}`);
    contents.forEach((content, index) => {
      const sender = index % 2 === 0 ? "架空のアオ" : "架空のキイ";
      const hours = 18 + Math.floor(index / 10);
      const minute = String((index * 5) % 60).padStart(2, "0");
      const time = `${String(hours).padStart(2, "0")}:${minute}`;
      // Quote multiline/TSV content according to LINE's TSV convention.
      const escaped = content.includes("\n") || content.includes("\t") || content.includes('"')
        ? `"${content.replaceAll('"', '""')}"` : content;
      lines.push(`${time}\t${sender}\t${escaped}`);
    });
  });
  return lines.join("\n") + "\n";
}

export function createSyntheticDemoChat(): ParsedChat {
  return parseLineChat(makeSyntheticDemoLineText());
}
