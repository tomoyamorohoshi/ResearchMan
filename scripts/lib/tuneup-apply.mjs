/**
 * biweekly-tuneup.mjs 用: ガードレール通過後の「書き込み→検証→revert判断」共通オーケストレーション。
 *
 * 2026-07-08 実機テストで、biweekly-tuneup.mjs --dry-run の実行を外部から中断（TaskStop/kill）
 * した際、書き込み済みの候補設定ファイルがrevertされないまま作業ツリーに残る事象が発生した
 * （中断自体はスクリプトのバグではなく外部要因だが、revertロジックがtry/finally相当で
 * 保証されておらず「検証失敗時のみ・dry-run成功時のみ」の個別分岐にrevert呼び出しが
 * 散らばっていたため、例外系の考慮漏れがないか監査しづらかった）。
 * ここへ切り出し、以下を**単一の実装**で保証する:
 *   - 検証ステップがfalseを返す・例外を投げる → dryRunに関わらず必ずrevertしてok:falseを返す
 *   - dryRun=trueで全検証成功 → revertしてok:true, reverted:trueを返す（コミット前提を残さない）
 *   - dryRun=falseで全検証成功 → revertせずok:true, reverted:falseを返す（変更を維持する）
 *
 * biweekly-tuneup.mjsのmain()はトップレベルで即時実行されるため単体テストできない
 * （OPERATIONS.md「main()を即実行するスクリプトをimportしない」参照）。ここに切り出すことで
 * 実ファイルI/O・実Claude CLI呼び出しなしにrevertルールを単体検証できる
 * （scripts/smoke-tuneup-apply.mjs 参照）。
 *
 * @param {object} opts
 * @param {() => Promise<void>} opts.writeFiles 候補設定ファイルの書き込み
 * @param {Array<() => Promise<boolean>>} opts.verifySteps 検証ステップ（順に実行。falseで即中断）
 * @param {() => Promise<void>} opts.revert 作業ツリーを書き込み前の状態へ戻す
 * @param {boolean} opts.dryRun
 * @returns {Promise<{ok: boolean, reverted: boolean, reason?: string}>}
 */
export async function applyCandidateWithVerification({ writeFiles, verifySteps, revert, dryRun }) {
  try {
    await writeFiles();
    for (const step of verifySteps) {
      const ok = await step();
      if (!ok) {
        await revert();
        return { ok: false, reverted: true, reason: "verification-failed" };
      }
    }
    if (dryRun) {
      await revert();
      return { ok: true, reverted: true };
    }
    return { ok: true, reverted: false };
  } catch (e) {
    // writeFiles・検証ステップいずれの例外でも、作業ツリーを汚したまま終わらせない。
    // revert自体は「コミット済みの状態へ戻す」操作（例: git checkout --）であり、まだ何も
    // 書かれていない状態に対して呼んでも副作用は無い（冪等）前提で常に呼ぶ
    await revert();
    return { ok: false, reverted: true, reason: `exception: ${e.message}` };
  }
}
