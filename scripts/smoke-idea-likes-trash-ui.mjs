// /ideas ページの「いいね」「ゴミ箱」UIのスモークテスト。
// scripts/smoke-synced-id-set.mjs (cases側) と同型の観点で、Ideasポスター
// (IdeasPoster.tsx/IdeaCardControls.tsx)固有の配線を検証する:
// - いいねトグルでlocalStorage(researchman-idea-likes)へ{version:1,items:{...}}形式で反映される
// - ゴミ箱に入れたカードが通常のポスター表示から消える(precomputedレイアウトは詰め直さない=
//   残りのカードの位置は変わらない、という設計上、単に対象カードが無くなることだけを確認する)
// - 「Trash n」トグルでゴミ箱ビューに切り替わり、ゴミ箱入りのみ表示される
// - ゴミ箱ビューで「復元」を押すと通常表示に戻る
//
// 前提: `next dev` を PORT=3457 で起動した状態で実行すること。
// 実行例:
//   PORT=3457 npx next dev &
//   npx tsx scripts/smoke-idea-likes-trash-ui.mjs
import { chromium } from "playwright";

const BASE_URL = process.env.IDEA_UI_SMOKE_URL || "http://localhost:3457";
const LIKES_KEY = "researchman-idea-likes";
const TRASH_KEY = "researchman-idea-trash";

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

async function waitForHydration(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
}

async function readKey(page, key) {
  return page.evaluate((k) => localStorage.getItem(k), key);
}

async function clearKeys(page) {
  await page.evaluate(
    ({ likes, trash }) => {
      localStorage.removeItem(likes);
      localStorage.removeItem(trash);
    },
    { likes: LIKES_KEY, trash: TRASH_KEY }
  );
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`${BASE_URL}/ideas`);
  await waitForHydration(page);
  await clearKeys(page);
  await page.reload();
  await waitForHydration(page);

  // 現在表示中(可視)のティアのカードから、テスト対象の2件のideaを取得する
  // (mobile/compact/wideの3ティアが同時にDOMへ存在し、非表示ティアはdisplay:noneのため
  // offsetParentで可視要素だけに絞る)
  const [idA, idB] = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-idea-id]"))
      .filter((el) => el instanceof HTMLElement && el.offsetParent !== null)
      .map((el) => el.getAttribute("data-idea-id"))
      .filter((id, i, arr) => arr.indexOf(id) === i)
      .slice(0, 2)
  );
  assert(
    typeof idA === "string" && typeof idB === "string" && idA !== idB,
    "テスト用に異なる2件のidea idが取得できる"
  );

  // --- 1. いいねトグル: localStorageへ{version:1,items:{...}}形式で反映される ---
  {
    // 3ティア分DOMに同じidea idのカードが存在する(非表示ティアはdisplay:none)ため、
    // :visible擬似クラスで可視ティアの1枚だけに絞る
    await page.locator(`[data-idea-id="${idA}"] button[aria-label="いいね"]:visible`).first().click();
    await page.waitForTimeout(150);
    const raw = await readKey(page, LIKES_KEY);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    assert(
      parsed && parsed.version === 1 && typeof parsed.items === "object",
      "いいね後、localStorageが{version:1,items:{...}}形式で保存される"
    );
    assert(parsed?.items?.[idA]?.fav === true, "いいねしたidはfav:trueとして保存される(共通ワイヤ形式)");
  }

  // --- 2. ゴミ箱トグル: localStorage(researchman-idea-trash)へ反映され、通常表示から消える ---
  {
    const beforeLikes = await readKey(page, LIKES_KEY);
    await page.locator(`[data-idea-id="${idA}"] button[aria-label="ゴミ箱に入れる"]:visible`).first().click();
    await page.waitForTimeout(150);
    const afterLikes = await readKey(page, LIKES_KEY);
    assert(afterLikes === beforeLikes, "ゴミ箱のtoggleはlikesキー(researchman-idea-likes)に影響しない");

    const trashRaw = await readKey(page, TRASH_KEY);
    const parsed = JSON.parse(trashRaw);
    assert(parsed?.items?.[idA]?.fav === true, "ゴミ箱行きにしたidはfav:trueとして保存される");

    const stillVisible = await page.evaluate(
      (id) =>
        Array.from(document.querySelectorAll(`[data-idea-id="${id}"]`)).some(
          (el) => el instanceof HTMLElement && el.offsetParent !== null
        ),
      idA
    );
    assert(!stillVisible, "ゴミ箱に入れたカードは通常のポスター表示から消える");
  }

  // --- 3. Trashビュー: 「Trash n」トグルでゴミ箱入りのみ表示され、ボタンが「復元」になる ---
  {
    const trashViewButton = page.getByRole("button", { name: /^Trash/ });
    await trashViewButton.click();
    await page.waitForTimeout(200);

    const visibleIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-idea-id]"))
        .filter((el) => el instanceof HTMLElement && el.offsetParent !== null)
        .map((el) => el.getAttribute("data-idea-id"))
        .filter((id, i, arr) => arr.indexOf(id) === i)
    );
    assert(
      visibleIds.length === 1 && visibleIds[0] === idA,
      `Trashビューではゴミ箱入りのidea(${idA})のみ表示される (got ${JSON.stringify(visibleIds)})`
    );

    const restoreButton = page.locator(`[data-idea-id="${idA}"] button[aria-label="復元"]:visible`).first();
    assert((await restoreButton.count()) === 1, "Trashビューでは対象カードのボタンが「復元」ラベルになる");
  }

  // --- 4. 復元: Trashビューで「復元」を押すと通常表示に戻る ---
  {
    await page.locator(`[data-idea-id="${idA}"] button[aria-label="復元"]:visible`).first().click();
    await page.waitForTimeout(150);

    const trashRaw = await readKey(page, TRASH_KEY);
    const parsed = JSON.parse(trashRaw);
    assert(parsed?.items?.[idA]?.fav === false, "復元後、trashキーの当該idはfav:falseになる(tombstone)");

    const trashViewButton = page.getByRole("button", { name: /^Trash/ });
    await trashViewButton.click(); // Trashビューを閉じて通常表示に戻す
    await page.waitForTimeout(200);

    const restoredVisible = await page.evaluate(
      (id) =>
        Array.from(document.querySelectorAll(`[data-idea-id="${id}"]`)).some(
          (el) => el instanceof HTMLElement && el.offsetParent !== null
        ),
      idA
    );
    assert(restoredVisible, "復元後、カードは通常のポスター表示に戻る");
  }

  await clearKeys(page);
  await browser.close();

  if (failures > 0) {
    console.error(`\n${failures} 件失敗`);
    process.exit(1);
  } else {
    console.log("\n全テストPASS: idea likes/trash UI");
  }
}

main().catch((err) => {
  console.error("smoke-idea-likes-trash-ui failed to run:", err);
  process.exit(1);
});
