/**
 * scripts/lib/thumbnail-page-check.mjs のスモークテスト（fixtureのみ・実HTTP呼び出しなし）。
 *
 * 敵対的レビューで検出した重大バグの回帰防止: resolveActualImageUrl が
 * `/_next/image?url=...` をデコードして下層の実ファイルパスへ潜っていた（2026-07-08
 * インシデント2「/thumbnails/*.jpg直接は200でもブラウザが実際にリクエストする
 * /_next/image?url=...&w=...&q=... が402」を、デコードすると取りこぼす＝
 * 検知すべき障害をフォールスネガティブで見逃す）。修正後は src 文字列を一切
 * デコード・書き換えせず、originを前置するだけであること。
 *
 * 使い方: node scripts/smoke-watchdog-thumbnail-check.mjs
 */
import assert from "assert";
import { extractImgSrcs, resolveActualImageUrl } from "./lib/thumbnail-page-check.mjs";

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
}

const ORIGIN = "https://research-man.vercel.app";

check("resolveActualImageUrl: 直接配信の相対パスはoriginを前置するだけ", () => {
  const result = resolveActualImageUrl("/thumbnails/foo-2026.jpg", ORIGIN);
  assert.strictEqual(result, "https://research-man.vercel.app/thumbnails/foo-2026.jpg");
});

check("resolveActualImageUrl: /_next/image?url=... はクエリ文字列を含めてそのまま解決する（デコードしない）", () => {
  const src = "/_next/image?url=%2Fthumbnails%2Ffoo-2026.jpg&w=3840&q=75";
  const result = resolveActualImageUrl(src, ORIGIN);
  // ブラウザが実際にリクエストするのはこのURLそのもの（/_next/image エンドポイント）。
  // 内部のurlクエリをデコードして下層の/thumbnails/foo-2026.jpgへ潜ってはいけない
  // （潜ると画像最適化プロキシの障害=インシデント2のパターンを検知できなくなる）。
  assert.strictEqual(result, "https://research-man.vercel.app" + src, `デコードせずクエリ込みで解決される想定: ${result}`);
  assert.ok(result.includes("/_next/image?url="), "/_next/imageエンドポイント自体が検査対象であること");
});

check("resolveActualImageUrl: 絶対URLはそのまま返す", () => {
  const abs = "https://cdn.example.com/foo.jpg";
  assert.strictEqual(resolveActualImageUrl(abs, ORIGIN), abs);
});

check("resolveActualImageUrl: 空/undefinedはそのまま返す（例外を投げない）", () => {
  assert.strictEqual(resolveActualImageUrl("", ORIGIN), "");
  assert.strictEqual(resolveActualImageUrl(undefined, ORIGIN), undefined);
});

check("extractImgSrcs: <img src=\"...\"> を出現順に抽出する", () => {
  const html = `<div><img alt="a" src="/thumbnails/a.jpg"><img alt="b" src="/thumbnails/b.jpg"></div>`;
  assert.deepStrictEqual(extractImgSrcs(html, 10), ["/thumbnails/a.jpg", "/thumbnails/b.jpg"]);
});

check("extractImgSrcs: limit件で打ち切る", () => {
  const html = `<img src="/a.jpg"><img src="/b.jpg"><img src="/c.jpg">`;
  assert.deepStrictEqual(extractImgSrcs(html, 2), ["/a.jpg", "/b.jpg"]);
});

check("extractImgSrcs: 空/undefinedは空配列", () => {
  assert.deepStrictEqual(extractImgSrcs(""), []);
  assert.deepStrictEqual(extractImgSrcs(undefined), []);
});

console.log(`\n${passed}件PASS`);
if (process.exitCode) {
  console.error("FAIL: 上記のテストが失敗しました");
} else {
  console.log("ALL PASS");
}
