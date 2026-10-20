/**
 * 週次見直し(biweekly-tuneup.mjs)と run-job.mjs の受け渡し。
 * data/case-gate.json・data/sources.json・data/litmus-history.json は他の経路（LINE承認・手作業）でも変わりうるため、
 *  - tuneup は開始時に未コミット差分があればそのファイルへの変更をスキップし、全戻しの対象からも外す
 *  - run-job.mjs は tuneup が「実際に書いた」ファイルだけを git add する（他者の未コミット変更を巻き込まない）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const GUARDED_PATHS = ["data/case-gate.json", "data/sources.json", "data/litmus-history.json"];
export const TUNEUP_TOUCHED_PATH = path.join(os.tmpdir(), "researchman-tuneup-touched.json");

/** `git status --porcelain` の出力から変更のあるパス一覧を返す。 */
export function dirtyPathsFromPorcelain(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    if (line.length < 4) continue;
    const rest = line.slice(3).trim();
    const p = rest.includes(" -> ") ? rest.split(" -> ").pop() : rest;
    out.push(p.replace(/^"|"$/g, ""));
  }
  return out;
}

/**
 * 開始時の未コミット差分で v3 の変更をスキップした週の警告（system-alerts へ。LINE には出さない）。
 * 対象ファイル以外の差分だけなら null。
 */
export function buildSkipAlert(dirtyPaths) {
  const hit = (dirtyPaths || []).filter((p) => GUARDED_PATHS.includes(p));
  if (!hit.length) return null;
  return {
    source: "tuneup",
    level: "warn",
    title: "週次見直しの v3 変更をスキップ（未コミット差分あり）",
    body: `未コミットのファイル: ${hit.join(", ")}。他経路の変更を消さないため、具体例の入れ替え・巡回先の変更をスキップしました。手でコミットするか、不要なら破棄（git checkout）してください。そのままだと毎週スキップされます。`,
  };
}

export function writeTouched(paths, file = TUNEUP_TOUCHED_PATH) {
  fs.writeFileSync(file, JSON.stringify([...new Set(paths)].filter((p) => GUARDED_PATHS.includes(p))));
}

export function readTouched(file = TUNEUP_TOUCHED_PATH) {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf-8"));
    return Array.isArray(v) ? v.filter((p) => GUARDED_PATHS.includes(p)) : [];
  } catch {
    return [];
  }
}

export function clearTouched(file = TUNEUP_TOUCHED_PATH) {
  try {
    fs.unlinkSync(file);
  } catch {
    /* 無ければ何もしない */
  }
}
