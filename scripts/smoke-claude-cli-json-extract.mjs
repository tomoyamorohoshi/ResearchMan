// scripts/lib/claude-cli.mjs のJSON抽出ロジック（extractBalancedBlocks / extractFirstParsableJson）
// の単体検証。2026-08-18: 良質な記事候補がJSON抽出の貪欲正規表現の失敗により
// article-generation-failed として誤棄却されていた事故（原因2）の回帰防止用。
// 原因1（--dangerously-skip-permissionsでファイル保存に逃げる挙動）はモデルの実際の判断に
// 依存し、Claude CLIを呼ばずには再現できないためここではテストしない
// （--disallowedToolsの追加は claude-cli.mjs の diff と `claude --help` 確認結果を報告に記載）。
// Claude CLIは呼ばない。抽出関数に文字列を直接渡す純関数テストのみ。
// 実行: node scripts/smoke-claude-cli-json-extract.mjs
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { extractBalancedBlocks, extractFirstParsableJson } from "./lib/claude-cli.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

async function main() {
  // ── 1. 素のJSONオブジェクト ──
  {
    const out = `{"summary": "テスト", "value": 1}`;
    const { value } = extractFirstParsableJson(out, { marker: '"summary"', openCh: "{", closeCh: "}" });
    assert(value?.summary === "テスト", "1. 素のJSONオブジェクトを抽出できる");
  }

  // ── 2. ```json コードフェンスで囲まれたJSON ──
  {
    const out = "```json\n{\"summary\": \"フェンス\", \"value\": 2}\n```";
    const { value } = extractFirstParsableJson(out, { marker: '"summary"', openCh: "{", closeCh: "}" });
    assert(value?.summary === "フェンス", "2. コードフェンス内のJSONを抽出できる");
  }

  // ── 3. 前後に説明文が付いたJSON ──
  {
    const out = `承知しました。以下がリクエストされた記事です。\n\n{"summary": "前後に説明文", "value": 3}\n\n以上、ご確認ください。`;
    const { value } = extractFirstParsableJson(out, { marker: '"summary"', openCh: "{", closeCh: "}" });
    assert(value?.summary === "前後に説明文", "3. 前後に説明文があってもJSONを抽出できる");
  }

  // ── 4. 文字列値の中に { や } を含むJSON（貪欲マッチが壊れていたケース）──
  {
    const out = `{"summary": "セット{リスト}の話。JSXの{expr}構文も含む", "overview": "a}b{c", "value": 4}`;
    const { value } = extractFirstParsableJson(out, { marker: '"summary"', openCh: "{", closeCh: "}" });
    assert(value !== undefined, "4. 文字列値に{}を含んでいてもパース成功する");
    assert(value?.value === 4, "4. 文字列値に{}を含む場合も正しいオブジェクトを抽出する（旧・貪欲正規表現は最後の}まで拾って壊れていた）");
  }

  // ── 5. JSONブロックが2つ以上あり、1つ目が壊れていて2つ目が正しいケース ──
  {
    // 1つ目: 意図的に構文を壊す（カンマ抜け＝実例の "Expected ',' or '}'" 相当）
    const broken = `{"summary": "壊れている" "value": 5}`;
    const ok = `{"summary": "正しい方", "value": 5}`;
    const out = `候補A:\n${broken}\n\n候補B（正しい）:\n${ok}`;
    const { value, blockCount } = extractFirstParsableJson(out, { marker: '"summary"', openCh: "{", closeCh: "}" });
    assert(value?.summary === "正しい方", "5. 1つ目が壊れていても2つ目の正しいJSONを採用する");
    assert(blockCount === 2, `5. 候補ブロックを2件として認識する（実際: ${blockCount}）`);
  }

  // ── 6. markerを含まない出力 → null / [] を返すこと ──
  {
    const outObj = `{"other": "markerなし"}`;
    const resObj = extractFirstParsableJson(outObj, { marker: '"summary"', openCh: "{", closeCh: "}" });
    assert(resObj.value === undefined && resObj.blockCount === 0, "6a. markerを含まないオブジェクトは候補0件でundefinedを返す");

    const outArr = `[{"other": "markerなし"}]`;
    const resArr = extractFirstParsableJson(outArr, { marker: '"techName"', openCh: "[", closeCh: "]" });
    assert(resArr.value === undefined && resArr.blockCount === 0, "6b. markerを含まない配列は候補0件でundefinedを返す");
  }

  // ── 7. 実際に棄却された data/inbox/case-instagram-refresh-2026.json の中身を模した長文JSON ──
  // （このファイルは読み取りのみ。編集も移動もしない）
  {
    const inboxPath = path.join(__dirname, "..", "data", "inbox", "case-instagram-refresh-2026.json");
    const realArticle = JSON.parse(await fs.readFile(inboxPath, "utf-8"));
    // 実運用のstdout出力を模して、前後に説明文＋整形JSONの体裁で流し込む
    const out = `以下がご依頼の記事です。\n\n\`\`\`json\n${JSON.stringify(realArticle, null, 2)}\n\`\`\`\n`;
    const { value } = extractFirstParsableJson(out, { marker: '"summary"', openCh: "{", closeCh: "}" });
    assert(value?.summary === realArticle.summary, "7. 実際に棄却された長文記事JSONを正しく抽出できる");
    assert(value?.evaluationImpact === realArticle.evaluationImpact, "7. 長文フィールド（evaluationImpact）も欠落なく抽出できる");
  }

  // ── extractBalancedBlocks 自体の低レベル検証（ネスト・エスケープ）──
  {
    const blocks = extractBalancedBlocks(`前置き {"a": {"b": 1}, "c": "x\\"y"} 後書き`, "{", "}");
    assert(blocks.length === 1, `低レベル: ネストしたオブジェクトを1ブロックとして数える（実際: ${blocks.length}）`);
    assert(blocks[0] === `{"a": {"b": 1}, "c": "x\\"y"}`, "低レベル: エスケープされたダブルクォートを含んでも正しく対応終端を見つける");
  }

  console.log(failures === 0 ? "\n全てOK" : `\n${failures}件失敗`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
