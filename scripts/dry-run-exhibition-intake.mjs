/**
 * 任意の記事/告知 URL を「Exhibition への投稿(intake)」として dry-run で流す確認用スクリプト。
 * 記事本文を取得 → Claude CLI で候補抽出 → processCandidates(origin:"intake", dryRun:true) の結果と、
 * userPicks に記録される内容を表示する。data/ には一切書かない（読み取りのみ・サムネ保存なし）。
 *
 * 使い方: node scripts/dry-run-exhibition-intake.mjs <URL> [--no-claude <candidates.json>]
 *   --no-claude: Claude を呼ばず、与えた候補 JSON（配列）をそのまま使う（再現・テスト用）
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { resolveClaudeBin, runClaudeJsonArray } from "./lib/claude-cli.mjs";
import { todayJst } from "./lib/exhibition-status.mjs";
import { processCandidates, htmlToText } from "./lib/exhibition-build.mjs";
import { applyUserPicks } from "./lib/exhibition-userpicks.mjs";
import { buildIntakePrompt, EXHIBITION_CLI_OPTS } from "./lib/exhibition-prompts.mjs";
import { readJson, defaultFetchHtml } from "./lib/exhibition-io.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = process.argv[2];
if (!url || !/^https?:\/\//.test(url)) {
  console.error("usage: node scripts/dry-run-exhibition-intake.mjs <URL> [--no-claude candidates.json]");
  process.exit(2);
}
const noClaudeIdx = process.argv.indexOf("--no-claude");
const today = todayJst();
const data = await readJson(path.join(ROOT, "data/exhibition.json"));
const profile = await readJson(path.join(ROOT, "data/exhibition-profile.json"));

let candidates;
if (noClaudeIdx > 0) {
  candidates = JSON.parse(await fs.readFile(process.argv[noClaudeIdx + 1], "utf-8"));
} else {
  const page = await defaultFetchHtml(url);
  if (!page || page.status !== 200) throw new Error(`記事を取得できません: ${page ? page.status : "unreachable"}`);
  const text = htmlToText(page.body).slice(0, 6000);
  candidates = runClaudeJsonArray(resolveClaudeBin(), buildIntakePrompt([{ url, text, author: "(dry-run)" }], profile, today), {
    timeout: 600000, marker: "intakeUrl", model: "sonnet", ...EXHIBITION_CLI_OPTS,
  });
}
candidates = candidates.map((c) => ({ ...c, origin: "intake", intakeUrl: url }));

const deps = {
  fetchHtml: defaultFetchHtml,
  saveThumb: async () => { throw new Error("dry-run では呼ばれない"); },
  now: () => new Date().toISOString(),
};
const out = await processCandidates({
  data, candidates, today, deps,
  opts: { addThreshold: profile.scoring.threshold.add, highlightThreshold: profile.scoring.threshold.highlight, dryRun: true },
});
const raw = candidates.map((c) => ({ title: c.title, rawScore: c.score, excludeCategory: c.excludeCategory }));
console.log(JSON.stringify({
  today, url, candidates: raw,
  outcome: out.added.length ? "added" : out.updated.length ? "updated" : out.unverified.length ? "unverified" : out.skipped.length ? "duplicate" : "rejected",
  added: out.added.map((a) => ({ id: a.id, title: a.title, venue: a.venue, period: `${a.startDate}〜${a.endDate}`, score: a.score, highlight: a.highlight, origin: a.origin })),
  unverified: out.unverified, rejected: out.rejected, skipped: out.skipped,
  userPicksToRecord: out.userPicks,
  profileUserPicksAfter: applyUserPicks(profile, out.userPicks).likes?.userPicks ?? [],
}, null, 2));
