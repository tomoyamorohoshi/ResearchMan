// 週次見直し(biweekly-tuneup)の dry-run 検証ステップの組み立て。
// cc 段だけ短縮モード（RESEARCHMAN_CC_VERIFY=1。scripts/lib/case-lenses.mjs の isVerifyMode 参照）で呼ぶ。
// 通常の cc dry-run は v3 で 45分を超え、毎回タイムアウト→全戻しになっていたため。tech/exhibition/ideas は従来どおり。
import { CC_VERIFY_ENV_KEY } from "./case-lenses.mjs";

export const VERIFY_NPM_SCRIPTS = ["ideas:dry", "auto-research:tech:dry", "auto-research:cc:dry", "auto-research:exhibition:dry"];

export function buildVerifySteps(runDry, baseEnv = process.env) {
  return VERIFY_NPM_SCRIPTS.map((npmScript) =>
    npmScript === "auto-research:cc:dry"
      ? () => runDry(npmScript, { env: { ...baseEnv, [CC_VERIFY_ENV_KEY]: "1" } })
      : () => runDry(npmScript)
  );
}
