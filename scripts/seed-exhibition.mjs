/**
 * Exhibition 初期データ投入（SPEC §9。1回限り・冪等）。
 *
 * data/exhibition-profile.json の seeds のうち role=listing かつ endDate >= 今日 のものだけを対象に、
 * 公式ページを再取得して日付・会場を機械照合 → サムネ取得 → score 計算 → data/exhibition.json へ書き出す。
 * 公式で確認できないもの（例: 公式未特定の展示）は掲載せず data/inbox/exhibition-unverified.json へ。
 * role=preference_only（BLACK AND BLUE・小松宏誠展）と終了済みは入れない。seed は手書きしない（下の SEED_META は
 * 「公式URL・タグ・入場料・一言」という調査メモのみで、日付・会場の正否は必ず公式ページ照合で決まる）。
 *
 * --news-inbox <file>: cases 形式の展覧会ニュース（例 data/inbox/japan-exhibition-2026-08-14.json の {found:[...]}）を
 *   Claude(WebSearch/WebFetch)で展覧会候補に変換し、日次ジョブと同じ機械検証（score>=add閾値）に通す。入力ファイルは変更しない。
 *
 * 使い方: node scripts/seed-exhibition.mjs [--dry-run] [--news-inbox <file>]
 * 環境変数: EXHIBITION_JOB_ROOT / EXHIBITION_JOB_TODAY
 */
import path from "path";
import { fileURLToPath } from "url";
import { todayJst } from "./lib/exhibition-status.mjs";
import { processCandidates } from "./lib/exhibition-build.mjs";
import { computeSeedScore } from "./lib/exhibition-score.mjs";
import { buildIntakePrompt, EXHIBITION_CLI_OPTS } from "./lib/exhibition-prompts.mjs";
import { readJson, writeJsonAtomic, appendUnverified, defaultFetchHtml, makeSaveThumb } from "./lib/exhibition-io.mjs";
import { resolveClaudeBin, runClaudeJsonArray } from "./lib/claude-cli.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.EXHIBITION_JOB_ROOT || path.join(__dirname, "..");
const TODAY = process.env.EXHIBITION_JOB_TODAY || todayJst();
const DRY_RUN = process.argv.includes("--dry-run");
const newsIdx = process.argv.indexOf("--news-inbox");
const NEWS_INBOX = newsIdx >= 0 ? process.argv[newsIdx + 1] : null;

// seed 毎の調査メモ（2026-10-04 に公式ページで確認した公式URL等）。キーは seeds[].title の先頭一致。
// 日付・会場は profile の seeds 値で、公式ページとの一致を verifyOfficialPage が毎回検証する。
const SEED_META = {
  "自己破壊芸術展": {
    officialUrl: "https://two.neort.io/ja/exhibitions/auto_destructive_art", // 主催 NEORT++ 自身の展覧会ページ
    venue: "NEORT++", // 公式ページの会場表記に合わせる（seed の "Maruka 3F" は階数・入居ビル名）
    venueType: "alt_space", tags: ["generative", "onchain", "media_art", "installation"], admission: "UNKNOWN", collectAll: true,
    matchReason: "NEORT++での、ブロックチェーン/計算システムを用いた作品の展覧会。荒川ゼロ一・exonemo・久保田晃弘・0xDEAFBEEF・0xfff・Toshi・Jonah Brucker-Cohenが参加（公式ページ記載）。",
  },
  "Machines of Loving Grace": {
    // 公式: カリモク家具の公式プレスリリース（会期・会場・主催Anthropicを明記）。X投稿は social ソースに降格
    officialUrl: "https://www.karimoku.co.jp/index.cgi?mode=press_detail&key=166",
    artists: ["真鍋大度", "神山友輔"], // 公式表記（profile seed の「小山祐介」は誤記）
    slugTitle: "machines-of-loving-grace", slugVenue: "karimoku-research-center",
    venueType: "corporate", tags: ["media_art", "ai_media_art", "kinetic", "installation", "sound"], admission: "無料",
    matchReason: "Anthropic主催。真鍋大度（モジュラーシンセと植物の生体電位を使う作品）と神山友輔（光るアームのキネティック・インスタレーション）がClaudeとの協働で制作した新作を展示（公式プレスリリース記載）。",
  },
  "多田美波": {
    officialUrl: "https://www.mot-art-museum.jp/exhibitions/Tada-Minami/", // MOT 公式の個別展覧会ページ
    slugTitle: "minami-tada-light", slugVenue: "mot",
    venueType: "museum", tags: ["light", "sculpture", "retrospective", "design_archive"], admission: "一般1600円",
    matchReason: "光の反射・屈折を取り込む造形と「光の造形」と呼ぶ照明作品を含む、没後初の大規模回顧展（公式ページ記載）。",
  },
  "アン・ヴェロニカ・ヤンセンス": {
    officialUrl: "https://www.hermes.com/jp/ja/content/401713-mgeditopagearticleforumf74/", // 銀座メゾンエルメス 公式
    slugTitle: "ann-veronica-janssens", slugVenue: "maison-hermes-le-forum",
    // 公式ページはJS描画で画像が取れないため、Tokyo Art Beat 掲載のキービジュアルを使用（日付・会場は公式ページで照合済み）
    thumbnailSource: "https://tab-prod-public.s3.ap-northeast-1.amazonaws.com/asset_files/uploaded/2026-09/9246e056/MAIN%20.jpg?w=1200",
    venueType: "corporate", tags: ["light", "installation", "sound", "sculpture"], admission: "無料",
    matchReason: "光・音・人工霧などの知覚/物質を扱う空間インスタレーションの作家による日本初の個展。",
  },
  "田中義久": {
    officialUrl: "https://www.dnpfcp.jp/CGI/gallery/schedule/detail.cgi?l=1&t=1&seq=00000861", // DNP文化振興財団(ggg運営) 公式の展覧会ページ
    slugTitle: "yoshihisa-tanaka-archive-achieve", slugVenue: "ggg",
    venueType: "corporate", tags: ["graphic_design", "design_archive"], admission: "無料",
    matchReason: "資料の保存・分類・展示の仕組みをグラフィックデザインの実践として捉え直すアーカイブ系のデザイン展。田中一光のアーカイブ資料も参照（公式ページ記載）。",
  },
  "没後20年 ナムジュン・パイク": {
    officialUrl: "http://www.watarium.co.jp/jp/exhibition/202607/", // ワタリウム美術館 公式（httpのみ）
    slugTitle: "nam-june-paik-jugemu", slugVenue: "watarium",
    venueType: "museum", tags: ["video_art", "media_art", "retrospective"], admission: "UNKNOWN",
    matchReason: "ビデオ・アート/メディアアートの源流であるナム・ジュン・パイクの没後20年展。",
  },
};

const metaFor = (title) => Object.entries(SEED_META).find(([k]) => title.startsWith(k))?.[1];
const socialKind = (u) => (/x\.com|twitter\.com|instagram\.com/.test(u) ? "social" : "listing");

async function main() {
  const profile = await readJson(path.join(ROOT, "data/exhibition-profile.json"));
  const data = await readJson(path.join(ROOT, "data/exhibition.json"));
  console.log(`seed 投入 today=${TODAY}${DRY_RUN ? "（dry-run）" : ""}`);

  const excluded = [];
  const candidates = [];
  for (const seed of profile.seeds) {
    if (seed.role !== "listing") { excluded.push({ title: seed.title, reason: `role=${seed.role}（嗜好専用）` }); continue; }
    if (seed.endDate < TODAY) { excluded.push({ title: seed.title, reason: `終了済み（${seed.endDate}）` }); continue; }
    const meta = metaFor(seed.title);
    if (!meta) { excluded.push({ title: seed.title, reason: "公式URLメモなし（SEED_META 未登録）" }); continue; }
    const venue = meta.venue || seed.venue;
    const artists = meta.artists || seed.artists;
    const c = {
      title: seed.title, artists, venue, venueType: meta.venueType, prefecture: seed.prefecture, city: seed.city,
      startDate: seed.startDate, endDate: seed.endDate, admission: meta.admission, tags: meta.tags,
      slugTitle: meta.slugTitle, slugVenue: meta.slugVenue,
      matchReason: meta.matchReason, officialUrl: meta.officialUrl, excludeCategory: "none", collectAll: !!meta.collectAll,
      sources: seed.url !== meta.officialUrl ? [{ name: "seed出所", url: seed.url, kind: socialKind(seed.url) }] : [],
      thumbnailSource: meta.thumbnailSource || meta.officialUrl,
    };
    c.score = computeSeedScore(c, profile, TODAY);
    candidates.push(c);
  }

  const deps = { fetchHtml: defaultFetchHtml, saveThumb: makeSaveThumb(path.join(ROOT, "public/thumbnails/exhibition")), now: () => new Date().toISOString() };
  const reservedIds = new Set();
  for (const f of ["data/cases.json", "data/tech.json"]) {
    try { for (const x of await readJson(path.join(ROOT, f))) if (x?.id) reservedIds.add(x.id); } catch {}
  }
  // seed はユーザー選定済みの listing なので add 閾値は掛けない（score は実力どおり記録）。公式照合・サムネは必須
  let out = await processCandidates({
    data, candidates, today: TODAY, deps,
    opts: { addThreshold: 0, highlightThreshold: profile.scoring.threshold.highlight, maxAdd: Infinity, dryRun: DRY_RUN, reservedIds },
  });

  let newsOut = null;
  if (NEWS_INBOX) {
    const raw = await readJson(NEWS_INBOX);
    const found = Array.isArray(raw) ? raw : raw.found || [];
    const posts = found.map((f) => ({ url: f.link, author: f.client || "", text: `${f.title}\n${f.note || ""}${f.date_note ? `\n${f.date_note}` : ""}` }));
    console.log(`news inbox: ${posts.length}件を Claude で展覧会候補化`);
    const extracted = runClaudeJsonArray(resolveClaudeBin(), buildIntakePrompt(posts, profile, TODAY), {
      timeout: 900000, marker: "intakeUrl", model: "sonnet", ...EXHIBITION_CLI_OPTS,
    });
    const cands = extracted.filter((x) => x && typeof x === "object").map(({ intakeUrl, ...rest }) => ({ ...rest, sources: [...(rest.sources || []), ...(intakeUrl ? [{ name: "展覧会ニュース", url: intakeUrl, kind: "news" }] : [])] }));
    newsOut = await processCandidates({
      data: out.data, candidates: cands, today: TODAY, deps,
      opts: { addThreshold: profile.scoring.threshold.add, highlightThreshold: profile.scoring.threshold.highlight, maxAdd: Infinity, dryRun: DRY_RUN, reservedIds },
    });
  }

  const all = (k) => [...out[k], ...(newsOut ? newsOut[k] : [])];
  const finalData = (newsOut || out).data;
  console.log("\n=== 入ったもの ===");
  for (const x of all("added")) console.log(`- ${x.title} | ${x.startDate}〜${x.endDate} | ${x.venue} | score=${x.score} | ${x.link}`);
  console.log("=== 入れなかったもの ===");
  for (const x of excluded) console.log(`- ${x.title}: ${x.reason}`);
  for (const x of all("unverified")) console.log(`- ${x.title}: unverified（${x.reason}）`);
  for (const x of all("rejected")) console.log(`- ${x.title}: reject（${x.reason}${x.detail ? ` ${x.detail}` : ""}）`);
  for (const x of all("skipped")) console.log(`- ${x.title}: 既存（${x.existingId}）`);

  if (DRY_RUN) { console.log("\n(dry-run: 書き込みなし)"); return; }
  await writeJsonAtomic(path.join(ROOT, "data/exhibition.json"), finalData);
  await appendUnverified(ROOT, all("unverified"));
  console.log(`\n✅ data/exhibition.json → ${finalData.items.length}件`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("❌", e); process.exit(1); });
