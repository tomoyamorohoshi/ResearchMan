/**
 * Technology タブの日次自動収集（TECHNOLOGY_SPEC.md Step 1）。
 *
 * 流れ:
 *   1. Claude CLI (WebSearch) が Tier 1 公開ソースから直近の新着技術を発見
 *      （レーンは日替わりローテーション。1回の呼び出しを軽く保つ）
 *   2. 候補JSONを build-tech-from-research.mjs へ渡し、一次ソース死活・
 *      Case Study重複・サムネイル取得の機械検証を通過したものだけ tech.json へ追加
 *   3. 通知サマリー /tmp/researchman-tech-last-add.json は build 側が書く（0件でも上書き）
 *
 * ゲート（1日1回）は launchd 側の run-if-due.mjs --state .last-tech-research-run.txt --hours 23 が担う。
 * 使い方: node scripts/auto-research-tech.mjs [--dry-run]
 */
import fs from "fs/promises";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { resolveClaudeBin, runClaudeJsonArray } from "./lib/claude-cli.mjs";
import { localDayIndex } from "./lib/day-index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TECH_PATH = path.join(__dirname, "../data/tech.json");
const LAST_RUN_PATH = path.join(__dirname, "../.last-tech-research-run.txt");
const DRY_RUN = process.argv.includes("--dry-run");

const MAX_ADD = 3; // 日次なので少数厳選（量はレーンローテーションで長期的に担保）
const MAX_ROUNDS = 2;
// リサーチ・記事化はSonnetで十分（既定の上位モデルだと遅くタイムアウトしやすい）
const MODEL = "sonnet";
const DISCOVER_TIMEOUT_MS = 600000;

// 恒久除外（クライテリア不適合が確定しているもの。TECHNOLOGY_SPEC.md参照）
const KNOWN_EXCLUDED = [
  "LUNA", "Lift4D", "One4D", "OneCanvas", "Surflo", "Gemma", "Huawei 3Dロック画面",
];

// ── 日替わりレーン（TECHNOLOGY_SPEC.md §2 Tier 1） ──────────────
const LANES = [
  {
    label: "Spatial/3D（3D/4D再構成・Gaussian Splatting・World Model・空間AI）",
    sources:
      "radiancefields.com / Hugging Face Daily Papers / arXiv cs.CV・cs.GR(コード公開済み) / NVIDIA・Meta AIのプロジェクトページ / GitHub Trendingの3D系",
  },
  {
    label: "GenVideo・CreatorTools（生成AI映像・動画編集AI・ComfyUI/Blender/UE/DaVinci拡張）",
    sources:
      "ComfyUI公式ブログ・comfy.org/workflows / Hugging Faceの動画系モデル・LoRA / 80.lv / GitHub Trending / Blender Extensions・UE Fabの注目アドオン",
  },
  {
    label: "HCI/MediaArt・Audio/Music・日本語圏（インタラクション研究・触覚・AI音楽。日本の研究室を厚めに）",
    sources:
      "shiropen.com(Seamless) / 落合研(Digital Nature Group)・暦本研・筧研など日本のHCI研究室 / SIGGRAPH・CHI・UISTの新着 / AI音楽ツール / 日本の個人開発者のGitHub",
  },
  {
    label: "Motion/Body・AI/Agents・企業研究ラボ（mocap・キャラアニメ・基盤モデルのクリエイティブ応用・ロボティクス×表現）",
    sources:
      "Meta AI・Google DeepMind・NVIDIA Research・Microsoft Researchの新着(コード公開済み) / Hugging Faceのモーション系 / GitHub Trendingのエージェント系",
  },
];

// Claude CLI 呼び出しは scripts/lib/claude-cli.mjs に共通化（resolveClaudeBin/runClaudeJsonArray）

function buildPrompt({ lane, existingTitles, seenThisRun }) {
  return `ResearchManサイト「Technology」タブの日次リサーチ。担当レーン: ${lane.label}

ミッション: **直近2週間程度に発表・公開された新着**からクライテリア適合の技術を最大3件発掘し、検証済みJSON配列で返す。該当なしなら空配列 [] を返す（無理に埋めない）。

探索ソース: ${lane.sources}

クライテリア（厳守・TECHNOLOGY_SPEC.md準拠）:
- Research = GitHub等でコードが実際に公開されているもののみ（README-onlyプレースホルダ不可。リポジトリの中身を確認）
- Tool = クリエイターが実際に使える実物（OSS or 有償で独自性。配布ページ実在確認）
- Prototype = 動くデモが映像で確認できる実験作。HCI/ハードウェア研究は査読付き発表+公式デモ映像があればコード無しでも可
- 除外: 論文のみ・コード未公開、製品ニュース、バージョン告知のみ、既存APIの薄いラッパー
- 全リンクは実際にアクセスして生存確認。推測URL禁止

重複禁止（既掲載・除外済み）: ${existingTitles}${seenThisRun.length ? ` / 今回既出: ${seenThisRun.join(", ")}` : ""}

執筆前の必須手順: summaryJa/pointJa/detailJa を書く前に、一次ソース（GitHub README・プロジェクトページ・
論文）を **WebFetch で実際に開いて読む**こと。検索結果のスニペットだけで書くことは禁止。
リンク先がWebFetchで読めない場合は https://r.jina.ai/<元URL> 経由で読んでよい。ただし出力JSONの
url には必ず**元URL**を書くこと（r.jina.ai・t.co を含むURLは出力禁止）。
それでも読めなかった（アクセス不能・内容が薄すぎる）技術は候補から外す。

文体ルール（重要）:
- 技術者でなくてもわかるように。専門用語には言い換えか身近な例えを添える。端的すぎるより丁寧に
- pointJa: 「何がすごいか」→「広告・体験づくりで何が作れそうか」の順で1段落350〜500字
- detailJa: 2〜3段落450〜700字。①仕組みの具体的説明（たとえ話OK） ②従来と何が違うか ③使うには何が必要か（機材・費用・スキル・入手方法）

出力はJSON配列のみ（前置き・後書きなし）:
[{
  "techName": "正式名", "org": "開発元",
  "type": "Research|Prototype|Tool",
  "domains": ["Spatial/3D","Motion/Body","GenVideo","CreatorTools","AI/Agents","HCI/MediaArt","Audio/Music"から1-3個],
  "date": "YYYY-MM",
  "links": [{"kind":"github|project|paper|post|product|video","url":"..."}],
  "license": {"spdx":"...or null","commercial":"ok|conditional|research-only|paid|none","note":"..."},
  "summaryJa": "概要1-2行", "pointJa": "...", "detailJa": "...",
  "relatedWorks": [{"title":"...","description":"1行","url":"..."} 2-3件],
  "thumbnailSource": "技術のデモ・キービジュアルが写る画像URL or そのog:imageを持つページURL（プロジェクトページやREADMEのヒーロー画像を優先。GitHubのopengraphカードはテキスト画像なので不可＝最終フォールバックは自動で入る）",
  "verdict": "adopt", "verdictReason": "..."
}]`;
}

async function saveLastRunDate() {
  try {
    await fs.writeFile(LAST_RUN_PATH, new Date().toISOString());
  } catch {}
}

async function main() {
  console.log(`\nResearchMan Technology 日次収集`);
  console.log(`   ${new Date().toLocaleString("ja-JP")}`);
  if (DRY_RUN) console.log("   ⚠ DRY RUN（tech.jsonは更新しません）");

  const tech = JSON.parse(await fs.readFile(TECH_PATH, "utf-8"));
  const existingTitles = [...tech.map((t) => t.title), ...KNOWN_EXCLUDED].join(" / ");
  console.log(`既存: ${tech.length}件`);

  // 日替わりレーン（JST暦日でローテーション。4レーンを順に巡回）
  const lane = LANES[localDayIndex() % LANES.length];
  console.log(`本日のレーン: ${lane.label}\n`);

  const claudeBin = resolveClaudeBin();
  const seenThisRun = [];
  const candidates = [];
  let discoveryErrors = 0;
  let roundsAttempted = 0;

  for (let round = 1; round <= MAX_ROUNDS && candidates.length < MAX_ADD; round++) {
    console.log(`── ラウンド ${round}/${MAX_ROUNDS}: 発見フェーズ ──`);
    roundsAttempted++;
    let found = [];
    try {
      found = runClaudeJsonArray(claudeBin, buildPrompt({ lane, existingTitles, seenThisRun }), {
        timeout: DISCOVER_TIMEOUT_MS,
        marker: "techName",
        model: MODEL,
        allowedTools: "WebSearch,WebFetch",
      });
    } catch (e) {
      console.error(`発見フェーズ失敗: ${e.message}`);
      discoveryErrors++;
      continue;
    }
    console.log(`候補: ${found.length}件`);
    for (const c of found) {
      if (!c?.techName || c.verdict !== "adopt") continue;
      seenThisRun.push(c.techName);
      candidates.push(c);
      if (candidates.length >= MAX_ADD) break;
    }
  }

  // 全ラウンドがエラー＝「0件」ではなく「収集失敗」。exit 1でplistのエラー通知経路へ
  if (!candidates.length && discoveryErrors >= roundsAttempted && discoveryErrors > 0) {
    console.error("発見フェーズが全ラウンド失敗 → 収集エラーとして終了");
    process.exit(1);
  }

  if (!candidates.length) {
    console.log("本日の新規候補なし");
    if (!DRY_RUN) {
      await saveLastRunDate();
      try {
        await fs.writeFile("/tmp/researchman-tech-last-add.json", JSON.stringify({ count: 0, cases: [] }, null, 2));
      } catch {}
    }
    return;
  }

  // 検証・追加は実績のある build-tech-from-research.mjs に委譲。
  // 候補ファイルは削除せず残す（検証で脱落した候補の調査・手動再取り込みに使う）。
  // 他の一時ファイル（researchman-last-add.json等）と同じく /tmp 直下に固定する
  // （os.tmpdir()はmacOSでは/var/folders/.../Tを指し/tmpと別ディレクトリになるため、
  //  「手動で/tmpを見て調査する」という目的に反する。過去にこの不一致で発見しづらいバグだった）
  const TMP_DIR = "/tmp";
  const day = new Date().toISOString().slice(0, 10);
  const tmpFile = path.join(TMP_DIR, `researchman-tech-candidates-${day}.json`);
  await fs.writeFile(tmpFile, JSON.stringify(candidates, null, 2));
  console.log(`\n候補${candidates.length}件を機械検証へ → ${tmpFile}`);

  // 14日より古い候補ファイルは掃除する（無限に溜まるのを防ぐ）。
  // dry-run時は状態を変えないルールに合わせてスキップ
  if (!DRY_RUN) {
    try {
      const CANDIDATE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
      for (const f of await fs.readdir(TMP_DIR)) {
        if (!f.startsWith("researchman-tech-candidates-")) continue;
        const fp = path.join(TMP_DIR, f);
        const st = await fs.stat(fp);
        if (Date.now() - st.mtimeMs > CANDIDATE_MAX_AGE_MS) {
          await fs.unlink(fp);
          console.log(`古い候補ファイルを削除: ${f}`);
        }
      }
    } catch {}
  }

  const buildArgs = [path.join(__dirname, "build-tech-from-research.mjs"), tmpFile, "--source", "Tech Radar"];
  if (DRY_RUN) buildArgs.push("--dry-run");
  const build = spawnSync("node", buildArgs, { encoding: "utf-8", stdio: "inherit", timeout: 600000 });
  if (build.status !== 0) {
    console.error("検証・追加フェーズが異常終了");
    process.exitCode = 1;
    return;
  }

  if (!DRY_RUN) await saveLastRunDate();
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error("\n❌ エラー:", e.message);
    process.exit(1);
  });
