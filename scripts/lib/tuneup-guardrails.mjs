/**
 * 隔週チューンアップ（scripts/biweekly-tuneup.mjs）のガードレール（機械検証）。
 *
 * Claude CLIが返すresearch-tuning.json/idea-tuning.json/x-radar-queries.jsonの改訂案は、
 * スキーマ・数値範囲・変更量のいずれかが逸脱したら**無条件に拒否**する（LLM出力を無検証で
 * 信用しない。実装計画 researchman-ops-routine.md バッチ2b参照）。
 *
 * ガードレール値（計画書どおり）:
 *   スキーマ: 型・必須キー・レーン数3〜6・クエリ数1〜6・重み0.25〜4.0・混合比合計=1(±0.01)
 *   変更量上限: レーン差替え(tech.lanes+cc.roundFoci合計)≤2・クエリ差替え≤3・重み変更≤10項目
 *   情報源レジストリ(data/sources.json): tier/enabled のみ変更可（tier≤5件・enabled≤5件）。
 *   id追加削除・kind/locator/lang/region等の変更はオーナー判断として機械的に拒否（設計 §4-12）
 */
import { validateSourcesRegistry } from "./sources-registry.mjs";

// スキーマ検証は sources-registry.mjs が実体（二重定義しない）。tuneup側の窓口としても公開する。
export { validateSourcesRegistry };

const LANE_COUNT_MIN = 3;
const LANE_COUNT_MAX = 6;
const QUERY_COUNT_MAX = 6;
const WEIGHT_MIN = 0.25;
const WEIGHT_MAX = 4.0;
const PATTERN_MIX_SUM_EPSILON = 0.01;

export const GUARDRAIL_LIMITS = {
  laneChangesMax: 2,
  queryChangesMax: 3,
  weightChangesMax: 10,
  sourceTierChangesMax: 5,
  sourceEnabledChangesMax: 5,
};

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function validateLaneArray(arr, requiredKeys, label, errors) {
  if (!Array.isArray(arr)) {
    errors.push(`${label} must be an array`);
    return;
  }
  if (arr.length < LANE_COUNT_MIN || arr.length > LANE_COUNT_MAX) {
    errors.push(`${label} count out of range [${LANE_COUNT_MIN},${LANE_COUNT_MAX}]: ${arr.length}`);
  }
  arr.forEach((item, i) => {
    if (!item || typeof item !== "object") {
      errors.push(`${label}[${i}] must be an object`);
      return;
    }
    for (const key of requiredKeys) {
      if (!isNonEmptyString(item[key])) {
        errors.push(`${label}[${i}].${key} must be a non-empty string`);
      }
    }
  });
}

/**
 * data/research-tuning.json 形式の候補を検証する。
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateResearchTuning(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== "object") {
    return { ok: false, errors: ["candidate must be an object"] };
  }
  if (!candidate.tech || typeof candidate.tech !== "object") {
    errors.push("tech must be an object");
  } else {
    validateLaneArray(candidate.tech.lanes, ["label", "sources"], "tech.lanes", errors);
  }
  if (!candidate.cc || typeof candidate.cc !== "object") {
    errors.push("cc must be an object");
  } else {
    // roundFoci は情報源を sources(自由文字列・従来) か sourceRefs(レジストリid配列) のどちらかで持つ
    // （data/sources.json の有効化前は sources にフォールバックするため両方併記が正常）
    validateLaneArray(candidate.cc.roundFoci, ["label", "diversity"], "cc.roundFoci", errors);
    if (Array.isArray(candidate.cc.roundFoci)) {
      candidate.cc.roundFoci.forEach((item, i) => {
        if (!item || typeof item !== "object") return;
        const hasSources = isNonEmptyString(item.sources);
        const refs = item.sourceRefs;
        if (refs !== undefined) {
          if (!Array.isArray(refs) || refs.length === 0 || !refs.every(isNonEmptyString)) {
            errors.push(`cc.roundFoci[${i}].sourceRefs must be a non-empty array of non-empty strings`);
            return;
          }
        }
        if (!hasSources && refs === undefined) {
          errors.push(`cc.roundFoci[${i}] must have sources (string) or sourceRefs (array)`);
        }
      });
    }
  }
  return { ok: errors.length === 0, errors };
}

/** data/x-radar-queries.json 形式（文字列配列）の候補を検証する。 */
export function validateXRadarQueries(candidate) {
  const errors = [];
  if (!Array.isArray(candidate)) {
    return { ok: false, errors: ["queries must be an array"] };
  }
  if (candidate.length < 1 || candidate.length > QUERY_COUNT_MAX) {
    errors.push(`queries count out of range [1,${QUERY_COUNT_MAX}]: ${candidate.length}`);
  }
  candidate.forEach((q, i) => {
    if (!isNonEmptyString(q)) errors.push(`queries[${i}] must be a non-empty string`);
  });
  return { ok: errors.length === 0, errors };
}

function validateWeightMap(map, label, errors) {
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    errors.push(`${label} must be an object`);
    return;
  }
  for (const [key, v] of Object.entries(map)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < WEIGHT_MIN || v > WEIGHT_MAX) {
      errors.push(`${label}.${key} out of range [${WEIGHT_MIN},${WEIGHT_MAX}]: ${v}`);
    }
  }
}

/**
 * data/idea-tuning.json 形式の候補を検証する。
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateIdeaTuning(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== "object") {
    return { ok: false, errors: ["candidate must be an object"] };
  }
  if (!Number.isInteger(candidate.seedCount) || candidate.seedCount < 1) {
    errors.push("seedCount must be a positive integer");
  }
  if (!Number.isInteger(candidate.caseSample) || candidate.caseSample < 1) {
    errors.push("caseSample must be a positive integer");
  }
  if (!Number.isInteger(candidate.techSample) || candidate.techSample < 1) {
    errors.push("techSample must be a positive integer");
  }

  const mix = candidate.patternMix;
  if (!mix || typeof mix !== "object") {
    errors.push("patternMix must be an object");
  } else {
    const keys = ["contextXTech", "techXTech", "repurpose", "free"];
    let sum = 0;
    for (const k of keys) {
      const v = mix[k];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
        errors.push(`patternMix.${k} must be a number in [0,1]`);
      } else {
        sum += v;
      }
    }
    if (Math.abs(sum - 1) > PATTERN_MIX_SUM_EPSILON) {
      errors.push(`patternMix values must sum to 1 (got ${sum})`);
    }
  }

  const weights = candidate.samplingWeights;
  if (!weights || typeof weights !== "object") {
    errors.push("samplingWeights must be an object");
  } else {
    validateWeightMap(weights.caseTags, "samplingWeights.caseTags", errors);
    validateWeightMap(weights.techDomains, "samplingWeights.techDomains", errors);
  }

  const pt = candidate.promptText;
  if (!pt || typeof pt !== "object") {
    errors.push("promptText must be an object");
  } else {
    if (!isNonEmptyString(pt.roleIntro)) errors.push("promptText.roleIntro must be a non-empty string");
    if (!isNonEmptyString(pt.styleNotes)) errors.push("promptText.styleNotes must be a non-empty string");
    const pd = pt.patternDefinitions;
    if (!pd || typeof pd !== "object") {
      errors.push("promptText.patternDefinitions must be an object");
    } else {
      for (const k of ["techXTech", "contextXTech", "repurpose"]) {
        if (!isNonEmptyString(pd[k])) errors.push(`promptText.patternDefinitions.${k} must be a non-empty string`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// ── 変更量カウント（新旧比較。置換数=|削除集合|と|追加集合|の大きい方） ──

function countReplacements(oldArr, newArr) {
  const oldSet = new Set((oldArr || []).map((x) => JSON.stringify(x)));
  const newSet = new Set((newArr || []).map((x) => JSON.stringify(x)));
  const removed = [...oldSet].filter((x) => !newSet.has(x)).length;
  const added = [...newSet].filter((x) => !oldSet.has(x)).length;
  return Math.max(removed, added);
}

/** tech.lanes + cc.roundFoci の合計変更数。 */
export function countLaneChanges(oldLanes, newLanes) {
  return countReplacements(oldLanes, newLanes);
}

/** x-radar-queries.json の変更数。 */
export function countQueryChanges(oldQueries, newQueries) {
  return countReplacements(oldQueries, newQueries);
}

/** samplingWeights（caseTags+techDomains）の変更項目数。未指定キーは既定1.0として比較する。 */
export function countWeightChanges(oldWeights, newWeights) {
  function countMap(oldMap, newMap) {
    const keys = new Set([...Object.keys(oldMap || {}), ...Object.keys(newMap || {})]);
    let n = 0;
    for (const k of keys) {
      const ov = oldMap?.[k] ?? 1.0;
      const nv = newMap?.[k] ?? 1.0;
      if (ov !== nv) n++;
    }
    return n;
  }
  return (
    countMap(oldWeights?.caseTags, newWeights?.caseTags) + countMap(oldWeights?.techDomains, newWeights?.techDomains)
  );
}

/**
 * research-tuning.json候補の総合ガードレール判定（スキーマ＋変更量上限）。
 * @returns {{ok: boolean, errors: string[], laneChanges: number}}
 */
export function checkResearchTuningChange(oldTuning, newTuning) {
  const schema = validateResearchTuning(newTuning);
  const errors = [...schema.errors];
  const laneChanges =
    countLaneChanges(oldTuning?.tech?.lanes, newTuning?.tech?.lanes) +
    countLaneChanges(oldTuning?.cc?.roundFoci, newTuning?.cc?.roundFoci);
  if (laneChanges > GUARDRAIL_LIMITS.laneChangesMax) {
    errors.push(`lane changes exceed limit (${laneChanges} > ${GUARDRAIL_LIMITS.laneChangesMax})`);
  }
  return { ok: errors.length === 0, errors, laneChanges };
}

/**
 * x-radar-queries.json候補の総合ガードレール判定（スキーマ＋変更量上限）。
 * @returns {{ok: boolean, errors: string[], queryChanges: number}}
 */
export function checkXRadarQueriesChange(oldQueries, newQueries) {
  const schema = validateXRadarQueries(newQueries);
  const errors = [...schema.errors];
  const queryChanges = countQueryChanges(oldQueries, newQueries);
  if (queryChanges > GUARDRAIL_LIMITS.queryChangesMax) {
    errors.push(`query changes exceed limit (${queryChanges} > ${GUARDRAIL_LIMITS.queryChangesMax})`);
  }
  return { ok: errors.length === 0, errors, queryChanges };
}

/**
 * idea-tuning.json候補の総合ガードレール判定（スキーマ＋変更量上限）。
 * @returns {{ok: boolean, errors: string[], weightChanges: number}}
 */
export function checkIdeaTuningChange(oldTuning, newTuning) {
  const schema = validateIdeaTuning(newTuning);
  const errors = [...schema.errors];
  const weightChanges = countWeightChanges(oldTuning?.samplingWeights, newTuning?.samplingWeights);
  if (weightChanges > GUARDRAIL_LIMITS.weightChangesMax) {
    errors.push(`weight changes exceed limit (${weightChanges} > ${GUARDRAIL_LIMITS.weightChangesMax})`);
  }
  return { ok: errors.length === 0, errors, weightChanges };
}

/**
 * data/sources.json の新旧比較（設計 §4-12）。許可する差分は既存id各件の tier・enabled のみ。
 * id の追加・削除、tier/enabled 以外の全フィールド（kind/locator/lang/region/hitDensity/note等）の
 * 変更は拒否。tier変更・enabled変更はそれぞれ GUARDRAIL_LIMITS の件数まで。
 * @returns {{ok: boolean, errors: string[], tierChanges: number, enabledChanges: number}}
 */
export function checkSourcesChange(oldSources, newSources) {
  const schema = validateSourcesRegistry(newSources);
  const errors = [...schema.errors];
  let tierChanges = 0;
  let enabledChanges = 0;
  if (Array.isArray(oldSources) && Array.isArray(newSources)) {
    const oldById = new Map(oldSources.map((s) => [s?.id, s]));
    const newById = new Map(newSources.map((s) => [s?.id, s]));
    for (const id of newById.keys()) if (!oldById.has(id)) errors.push(`source id added (owner decision): ${id}`);
    for (const id of oldById.keys()) if (!newById.has(id)) errors.push(`source id removed (owner decision): ${id}`);
    for (const [id, o] of oldById) {
      const n = newById.get(id);
      if (!n || !o) continue;
      if (o.tier !== n.tier) tierChanges++;
      if (o.enabled !== n.enabled) enabledChanges++;
      const keys = new Set([...Object.keys(o), ...Object.keys(n)]);
      for (const k of keys) {
        if (k === "tier" || k === "enabled") continue;
        if (JSON.stringify(o[k]) !== JSON.stringify(n[k])) errors.push(`source ${id}: field "${k}" change not allowed (owner decision)`);
      }
    }
  }
  if (tierChanges > GUARDRAIL_LIMITS.sourceTierChangesMax) {
    errors.push(`source tier changes exceed limit (${tierChanges} > ${GUARDRAIL_LIMITS.sourceTierChangesMax})`);
  }
  if (enabledChanges > GUARDRAIL_LIMITS.sourceEnabledChangesMax) {
    errors.push(`source enabled changes exceed limit (${enabledChanges} > ${GUARDRAIL_LIMITS.sourceEnabledChangesMax})`);
  }
  return { ok: errors.length === 0, errors, tierChanges, enabledChanges };
}
