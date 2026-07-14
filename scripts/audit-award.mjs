/**
 * アワード非依存の汎用網羅監査エンジン。
 *
 * data/cannes2026-winners-v2.json のようなアワード別「正解リスト」(ref)の各受賞について、
 * cases.json に「その作品が・その部門で」登録されているか（award文字列に当該部門が含まれるか）を
 * 確認する。抜けがあれば一覧表示して exitCode 1。LLMに依存しない単一ソースの真実チェック。
 *
 * 元々は scripts/audit-cannes.mjs にカンヌ専用ロジックとして実装されていたが、D&AD・One Show等
 * 他アワードでも同種の監査が必要になったため、award非依存のロジックをこのファイルに切り出し、
 * カンヌ固有の知識（VERIFIED_CATEGORIES・awardHasCategoryのswitch文・ALIAS・STOP等）は
 * 呼び出し側（audit-cannes.mjsのような薄いラッパー）が options 経由で注入する設計にした。
 *
 * 使い方（CLI）:
 *   node scripts/audit-award.mjs --ref <path> --award-prefix "<prefix>"
 *     [--cases <path>] [--verified-categories a,b,c] [--strict] [--out <path>]
 *
 * 使い方（モジュール）: import { runAudit } from "./audit-award.mjs"
 *   runAudit({ refPath | refWinners, casesPath | caseRecords, awardPrefix, ... })
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// デフォルトの英語ストップワード（audit-cannes.mjsのSTOPと同等）。
const DEFAULT_STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "for", "to", "in", "on", "is", "2026", "campaign", "lions", "x", "by", "ft", "feat",
]);

// award文字列がその部門(cat)を含むかの素朴なデフォルト判定（大文字小文字を無視した部分一致）。
// カンヌのような表記ゆれ（"Film"と"Film Craft"の区別等）には対応しない。将来他アワードで
// 使う際は呼び出し側でより精密な実装を渡すことを前提にした最小実装。
function defaultAwardHasCategory(award, cat) {
  const a = (award || "").toLowerCase();
  const c = (cat || "").toLowerCase();
  return !!c && a.includes(c);
}

// セグメントからレベル（Grand Prix/Titanium/Gold/Silver/Bronze）を抽出するデフォルト実装。
// 何も抽出できない場合はnullを返し、呼び出し元でレベル不一致チェックが静かにスキップされる
// （既存の安全側動作を維持）。他アワードの階級語彙は呼び出し側でオーバーライドする前提。
function defaultExtractLevel(segment) {
  const s = (segment || "").toLowerCase();
  if (/grand prix/.test(s)) return "Grand Prix";
  if (/titanium/.test(s)) return "Titanium";
  if (/\bgold\b/.test(s)) return "Gold";
  if (/\bsilver\b/.test(s)) return "Silver";
  if (/\bbronze\b/.test(s)) return "Bronze";
  return null;
}

const deaccent = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");

function makeTextUtils(stopwords) {
  const norm = (s) =>
    deaccent(s || "")
      .toLowerCase()
      .replace(/[（(].*?[）)]/g, " ")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9\s]/g, " ");
  const toks = (s) => new Set(norm(s).split(/\s+/).filter((w) => w && w.length > 1 && !stopwords.has(w)));
  const jac = (a, b) => {
    const i = [...a].filter((x) => b.has(x)).length;
    const u = new Set([...a, ...b]).size;
    return u ? i / u : 0;
  };
  const flat = (s) => norm(s).replace(/\s/g, "");
  return { norm, toks, jac, flat };
}

// award文字列を "/" 区切りのセグメントに分解
function awardSegments(award) {
  return (award || "").split("/").map((s) => s.trim()).filter(Boolean);
}

/**
 * 監査ロジック本体。
 * @param {object} options
 * @param {string} [options.refPath] ref JSON（{winners:[...]}）のパス。refWinners未指定時に使用
 * @param {Array} [options.refWinners] refの受賞配列を直接渡す（テスト用）。指定時はrefPathより優先
 * @param {string} [options.casesPath] cases.json相当のパス。既定は data/cases.json
 * @param {Array} [options.caseRecords] cases配列を直接渡す（テスト用）。指定時はcasesPathより優先
 * @param {string} options.awardPrefix 必須。cases側のaward文字列フィルタ＆余分セグメント検出の対象年フィルタ
 * @param {Set<string>|string[]} [options.verifiedCategories] レベル不一致をFAILに昇格させる部門
 * @param {(award:string, category:string)=>boolean} [options.awardHasCategory]
 * @param {(segment:string)=>string|null} [options.extractLevel]
 * @param {object} [options.alias] タイトル表記ゆれの手動対応表（flat(title) -> case id）
 * @param {Set<string>} [options.stopwords]
 * @param {boolean} [options.strict]
 * @param {string|null} [options.outPath]
 * @param {string} [options.label] ログ見出し用（例 "Cannes 2026"）
 * @returns {{exitCode: number, report: {missing: Array, levelMismatches: Array, extraSegments: Array}}}
 */
export function runAudit(options = {}) {
  const {
    refPath = null,
    refWinners = null,
    casesPath = null,
    caseRecords = null,
    awardPrefix,
    awardHasCategory = defaultAwardHasCategory,
    extractLevel = defaultExtractLevel,
    alias = {},
    stopwords = DEFAULT_STOPWORDS,
    strict = false,
    outPath = null,
  } = options;

  if (!awardPrefix) throw new Error("runAudit: awardPrefix is required");
  const label = options.label || awardPrefix;

  let rawRef = null;
  let ref = refWinners;
  if (!ref) {
    rawRef = JSON.parse(fs.readFileSync(refPath, "utf8"));
    ref = rawRef.winners;
  }

  // verifiedCategories明示指定を優先。未指定ならref JSON側のverifiedCategoriesフィールドを
  // フォールバックとして使う（無ければ空）。
  const verifiedCategoriesInput =
    options.verifiedCategories !== undefined ? options.verifiedCategories : (rawRef && rawRef.verifiedCategories) || [];
  const verifiedSet = verifiedCategoriesInput instanceof Set ? verifiedCategoriesInput : new Set(verifiedCategoriesInput);

  const allCases = caseRecords || JSON.parse(fs.readFileSync(casesPath || path.join(__dirname, "../data/cases.json"), "utf8"));
  const cn = allCases.filter((c) => (c.award || "").includes(awardPrefix));

  const { toks, jac, flat } = makeTextUtils(stopwords);

  function findAllRM(rec) {
    const f = flat(rec.title);
    if (alias[f]) {
      const a = cn.find((c) => c.id === alias[f]);
      return a ? [a] : [];
    }
    const rt = toks(rec.title),
      rb = flat(rec.brand);
    const m = [];
    for (const c of cn) {
      const ct = toks(c.title);
      let s = jac(rt, ct);
      if (flat(c.title) === f) s = 1;
      else if (rb && flat(c.client) && (flat(c.client).includes(rb) || rb.includes(flat(c.client))) && jac(rt, ct) >= 0.3)
        s = Math.max(s, 0.8);
      if (s >= 0.5) m.push(c);
    }
    return m;
  }

  const ALL_CATEGORIES = [...new Set(ref.map((w) => w.category))];
  function segmentCategory(segment) {
    for (const cat of ALL_CATEGORIES) {
      if (awardHasCategory(segment, cat)) return cat;
    }
    return null;
  }

  const missing = [];
  // caseId -> 参照リスト上でこのcaseにマッチした部門のSet（余分事例検出に使う）
  const caseRefCategories = new Map();
  // id|category -> 参照側の全レベルの集合
  const refLevelsByCase = new Map();

  for (const w of ref) {
    const matches = findAllRM(w);
    const covered = matches.length && matches.some((m) => awardHasCategory(m.award, w.category));
    if (!covered) missing.push(w);

    for (const m of matches) {
      if (!awardHasCategory(m.award, w.category)) continue;
      if (!caseRefCategories.has(m.id)) caseRefCategories.set(m.id, new Set());
      caseRefCategories.get(m.id).add(w.category);

      const key = `${m.id}|${w.category}`;
      if (!refLevelsByCase.has(key)) refLevelsByCase.set(key, new Set());
      refLevelsByCase.get(key).add(w.level);
    }
  }

  // レベル不一致判定: 同一id+categoryについて、RM記載の全レベルと参照側の全レベルの集合が
  // 1つでも交差すればOK（同一部門内の複数レベル受賞を「片方だけ書けば良い」として許容する）
  const levelMismatches = [];
  for (const [key, refLevels] of refLevelsByCase) {
    const [id, category] = key.split("|");
    const m = cn.find((c) => c.id === id);
    if (!m) continue;
    const matchingSegs = awardSegments(m.award).filter((s) => awardHasCategory(s, category));
    if (!matchingSegs.length) continue;
    const foundLevels = matchingSegs.map(extractLevel).filter(Boolean);
    if (!foundLevels.length) continue;
    const hasIntersection = foundLevels.some((l) => refLevels.has(l));
    if (!hasIntersection) {
      levelMismatches.push({
        id,
        category,
        refLevel: [...refLevels].join("/"),
        foundLevels: foundLevels.join("/"),
        segments: matchingSegs.join(" | "),
      });
    }
  }

  // 余分事例検出: cases.json側の各awardセグメントが指す部門が、参照リストにこのcase用として無いもの。
  // 参照リストは対象年のみなので、award文字列中の他年セグメントは対象外
  const extraSegments = [];
  for (const c of cn) {
    const refCats = caseRefCategories.get(c.id) || new Set();
    for (const seg of awardSegments(c.award)) {
      if (!seg.includes(awardPrefix)) continue;
      const cat = segmentCategory(seg);
      if (!cat) continue; // 部門判定できないセグメントは安全側でスキップ
      if (!refCats.has(cat)) extraSegments.push({ id: c.id, category: cat, segment: seg });
    }
  }

  const byCat = {};
  missing.forEach((w) => (byCat[w.category] = byCat[w.category] || []).push(w));
  console.log(`${label} deterministic audit — reference winners: ${ref.length}, RM 2026 cases: ${cn.length}`);

  const report = { missing, levelMismatches, extraSegments };
  if (outPath) fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  if (missing.length === 0) {
    console.log("✓ PASS — RMは正解リストの全受賞作を部門単位で網羅しています。");
  } else {
    console.log(`✗ FAIL — ${missing.length} 件の受賞が RM で未カバー:\n`);
    for (const cat of Object.keys(byCat).sort()) {
      console.log(`### ${cat} (${byCat[cat].length})`);
      byCat[cat].forEach((w) => console.log(`   - ${w.level}: ${w.title} — ${w.brand}`));
    }
  }

  // 公式照合済み部門のレベル不一致はFAIL、未検証部門はWARNのまま
  const verifiedMismatches = levelMismatches.filter((m) => verifiedSet.has(m.category));
  const unverifiedMismatches = levelMismatches.filter((m) => !verifiedSet.has(m.category));

  if (verifiedMismatches.length) {
    console.log(`\n✗ FAIL — 公式照合済み部門のレベル不一致 ${verifiedMismatches.length} 件（v2は公式確定のため誤りとして扱う）:`);
    verifiedMismatches.forEach((m) => console.log(`   - ${m.id} [${m.category}]: 公式=${m.refLevel} / RM記載=${m.foundLevels}`));
  }
  if (unverifiedMismatches.length) {
    console.log(`\n⚠ WARN — 未検証部門のレベル不一致 ${unverifiedMismatches.length} 件（参照リストが旧v1由来・未公式照合のため確定ではない）:`);
    unverifiedMismatches.forEach((m) => console.log(`   - ${m.id} [${m.category}]: 参照=${m.refLevel} / RM記載=${m.foundLevels}`));
  }
  if (extraSegments.length) {
    console.log(`\n⚠ WARN — 余分な部門セグメント ${extraSegments.length} 件（参照リストに対応winnerが無い。参照リストの欠落かRM側の誤りの可能性）:`);
    extraSegments.forEach((e) => console.log(`   - ${e.id}: "${e.segment}"`));
  }

  const hardFail = missing.length > 0 || verifiedMismatches.length > 0;
  const softFail = strict && (unverifiedMismatches.length > 0 || extraSegments.length > 0);
  const exitCode = hardFail || softFail ? 1 : 0;

  return { exitCode, report };
}

// CLIブロック: このファイルが直接実行された場合のみ動く
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const getFlag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : null;
  };
  const refPath = getFlag("--ref");
  const awardPrefix = getFlag("--award-prefix");
  const casesPath = getFlag("--cases") || null;
  const verifiedCategoriesArg = getFlag("--verified-categories");
  // 未指定時はundefinedのまま渡す（[]を渡すとrunAudit内のref JSON側verifiedCategories
  // フォールバックが常にスキップされてしまうため）。
  const verifiedCategories = verifiedCategoriesArg
    ? verifiedCategoriesArg.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const strict = argv.includes("--strict");
  const outPath = getFlag("--out");

  if (!refPath || !awardPrefix) {
    console.error(
      '使い方: node scripts/audit-award.mjs --ref <path> --award-prefix "<prefix>" [--cases <path>] [--verified-categories a,b,c] [--strict] [--out <path>]'
    );
    process.exit(1);
  }

  const result = runAudit({
    refPath,
    casesPath,
    awardPrefix,
    verifiedCategories,
    strict,
    outPath,
    label: awardPrefix,
  });
  process.exit(result.exitCode);
}
