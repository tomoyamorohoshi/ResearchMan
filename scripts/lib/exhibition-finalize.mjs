/**
 * Exhibition 日次ジョブの「確定」を監査通過後に遅らせる（投稿が消えない順序。docs/INTAKE_NO_FAIL.md）。
 *
 * auto-research-exhibition.mjs は data/exhibition.json を書くだけで、次の2つは確定しない:
 *   - intake の PATCH（サーバ側の投稿キューから外す）
 *   - 保留リストの更新（処理済みの除去・attempts 加算）
 * 代わりに計画を data/inbox/exhibition-finalize.json に残し、run-job.mjs が audit-exhibition 通過後に
 * `auto-research-exhibition.mjs --finalize` で確定する。監査 FAIL で data/exhibition.json が巻き戻されても、
 * 投稿は intake キュー（PATCH 前）か保留リスト（更新前）に残る。次回起動時に未確定の計画は破棄する
 * （再処理は dedupe で冪等）。ローカルのキューでコミットしない。
 */
import fs from "fs/promises";
import path from "path";
import { readJson, writeJsonAtomic } from "./exhibition-io.mjs";
import { commitPending } from "./exhibition-pending.mjs";

export const FINALIZE_REL = "data/inbox/exhibition-finalize.json";

/** 確定計画を保存する。intakePatch が空・pendingPlan が null なら何もしない。 */
export async function stageFinalize(root, { intakePatch = [], pendingPlan = null, today = "" }) {
  if (!intakePatch.length && !pendingPlan) return false;
  await writeJsonAtomic(path.join(root, FINALIZE_REL), { version: 1, today, intakePatch, pendingPlan });
  return true;
}

/** 前回起動で確定されなかった計画（監査 FAIL 等）を破棄する。破棄したら true。 */
export async function discardStaleFinalize(root) {
  try {
    await fs.unlink(path.join(root, FINALIZE_REL));
    return true;
  } catch (e) {
    if (e?.code === "ENOENT") return false;
    throw e;
  }
}

/**
 * 計画を確定する（監査通過後だけ呼ぶ）。PATCH の失敗は致命でない（投稿は次回 GET で戻り dedupe で冪等）。
 * @param {{root:string, patch:(results:object[])=>Promise<any>, today:string}} p  today は JST 暦日（計画の today と違えば stale）
 */
export async function runFinalize({ root, patch, today }) {
  const p = path.join(root, FINALIZE_REL);
  let plan;
  try {
    plan = await readJson(p);
  } catch (e) {
    if (e?.code === "ENOENT") return { ok: true, none: true, patched: false };
    return { ok: false, none: false, patched: false, error: `finalize 計画を読めません（${e.message}）` };
  }
  // 別の日の計画（前回の監査 FAIL で巻き戻された日の残りなど）は確定せず破棄する。discardStaleFinalize が失敗して残っていても確定に進まない
  if (plan?.today !== today) {
    await fs.unlink(p).catch(() => {});
    return { ok: true, none: false, stale: true, patched: false };
  }
  const errors = [];
  let patched = false;
  const results = Array.isArray(plan?.intakePatch) ? plan.intakePatch : [];
  if (results.length) {
    try {
      await patch(results);
      patched = true;
    } catch (e) {
      errors.push(`PATCH 失敗（${e.message}）`);
    }
  }
  if (plan?.pendingPlan) {
    try {
      await commitPending(root, plan.pendingPlan);
    } catch (e) {
      errors.push(`保留リスト更新失敗（${e.message}）`);
    }
  }
  await fs.unlink(p).catch(() => {});
  return { ok: errors.length === 0, none: false, patched, ...(errors.length ? { error: errors.join(" / ") } : {}) };
}
