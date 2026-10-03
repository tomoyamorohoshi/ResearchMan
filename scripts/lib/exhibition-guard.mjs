/**
 * Exhibition 日次ジョブの commit 前ガード（push 滞留事故の再発防止）。
 * 監査（audit-exhibition.mjs）に落ちるデータを commit すると pre-push で全 push が止まるため、
 * commit 前に同じ監査を走らせ、落ちたら作業ツリーを元に戻して commit しない。
 */

/** 失敗 run の作業ツリー復元。追跡ファイルは checkout、新規サムネ（未追跡）だけ clean で除去する。 */
export const EXHIBITION_REVERT_GIT_ARGS = [
  ["checkout", "--", "data/exhibition.json"],
  ["clean", "-fd", "public/thumbnails/exhibition"],
];

/**
 * @param {{audit:()=>{status:number|null}, revert:()=>void}} p
 * @returns {{ok:true}|{ok:false, status:number|null}}
 */
export function guardAudit({ audit, revert }) {
  const r = audit();
  if (r && r.status === 0) return { ok: true };
  revert();
  return { ok: false, status: r ? r.status : null };
}
