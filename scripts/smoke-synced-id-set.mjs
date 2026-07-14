// createSyncedIdSet.ts（お気に入り/ごみ箱で共通化した同期ファクトリ）の
// ロジック検証。useFavorites.ts側は既存のscripts/smoke-favorites-ui.mjsで厚く
// 回帰確認済みのため、ここでは「ファクトリとして複数インスタンス（favorites/trash）を
// 独立に持てるか」に焦点を当てる:
// - storageKey分離（片方をtoggleしてももう片方のlocalStorageキーに影響しない）
// - ごみ箱側でも旧形式(string[])マイグレーションが機能する（factory共通ロジックであることの確認）
// - ごみ箱側のtoggle・永続化（{version:1,items:{...}}形式）
// - ごみ箱側のサーバ応答マージ反映（/api/trashのモック経由。favorites側と同型の配線）
// - TOPのTrashビュー/Savedビューが排他であること（GalleryClient側の要件）
// 実行: PORT=3111 npx next dev の後、npx tsx scripts/smoke-synced-id-set.mjs
import { chromium } from "playwright";

const BASE_URL = process.env.SYNCED_ID_SET_SMOKE_URL || "http://localhost:3111";
const FAVORITES_KEY = "creative-edge-favorites";
const TRASH_KEY = "researchman-trash";

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
    ({ fav, trash }) => {
      localStorage.removeItem(fav);
      localStorage.removeItem(trash);
    },
    { fav: FAVORITES_KEY, trash: TRASH_KEY }
  );
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(BASE_URL);
  await waitForHydration(page);
  await clearKeys(page);
  await page.reload();
  await waitForHydration(page);

  const [idA, idB] = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-case-id]"))
      .slice(0, 2)
      .map((el) => el.getAttribute("data-case-id"))
  );
  assert(
    typeof idA === "string" && typeof idB === "string" && idA !== idB,
    "テスト用に異なる2件のcase idが取得できる"
  );

  // --- 1. storageKey分離: お気に入りをtoggleしてもtrashキーは変化しない ---
  {
    const before = await readKey(page, TRASH_KEY);
    await page.locator(`[data-case-id="${idA}"] button[aria-label="お気に入りに追加"]`).click();
    await page.waitForTimeout(150);
    const after = await readKey(page, TRASH_KEY);
    assert(after === before, "お気に入りのtoggleはtrashキー(researchman-trash)に影響しない");
  }

  // --- 2. storageKey分離: ごみ箱をtoggleしてもfavoritesキーは変化しない(お気に入り状態は保たれる) ---
  {
    const beforeFav = await readKey(page, FAVORITES_KEY);
    await page.locator(`[data-case-id="${idA}"] button[aria-label="ごみ箱に入れる"]`).click();
    await page.waitForTimeout(150);
    const afterFav = await readKey(page, FAVORITES_KEY);
    assert(afterFav === beforeFav, "ごみ箱のtoggleはfavoritesキー(creative-edge-favorites)に影響しない");
  }

  // --- 3. ごみ箱toggle後、永続化形式は{version:1,items:{...}}で、対象idはtrashedカードとして一覧から消える ---
  {
    const trashRaw = await readKey(page, TRASH_KEY);
    let parsed;
    try {
      parsed = JSON.parse(trashRaw);
    } catch {
      parsed = null;
    }
    assert(
      parsed && parsed.version === 1 && typeof parsed.items === "object",
      "ごみ箱行き後、localStorageが{version:1,items:{...}}形式で保存される"
    );
    assert(parsed?.items?.[idA]?.fav === true, "ごみ箱行きにしたidはfav:trueとして保存される(共通ワイヤ形式)");

    const cardStillVisible = await page.locator(`[data-case-id="${idA}"]`).count();
    assert(cardStillVisible === 0, "ごみ箱に入れたカードは通常のTOP一覧から消える");
  }

  // --- 4. Trashビュー: トグルONで trashed のみ表示され、ボタンが「復元」になる ---
  {
    const trashViewButton = page.getByRole("button", { name: /^Trash/ });
    await trashViewButton.click();
    await page.waitForTimeout(200);

    const visibleIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-case-id]"))
        .filter((el) => el instanceof HTMLElement && el.offsetParent !== null)
        .map((el) => el.getAttribute("data-case-id"))
    );
    assert(
      visibleIds.length === 1 && visibleIds[0] === idA,
      `Trashビューでは trashed のカード(${idA})のみ表示される (got ${JSON.stringify(visibleIds)})`
    );

    const restoreButton = page.locator(`[data-case-id="${idA}"] button[aria-label="復元"]`);
    assert((await restoreButton.count()) === 1, "Trashビューでは対象カードのボタンが「復元」ラベルになる");
  }

  // --- 5. Saved/Trashは排他: Trashビュー中にSavedを開くとTrashは閉じる ---
  {
    const savedButton = page.getByRole("button", { name: /^Saved/ });
    await savedButton.click();
    await page.waitForTimeout(200);
    const trashViewButton = page.getByRole("button", { name: /^Trash/ });
    // Trashトグルの押下状態(色)をclassで判定する代わりに、一覧内容で判定する:
    // Saved側に切り替わった時点でidAはtrashed(=通常一覧からは除外)かつfavではないため
    // Savedフィルタ一覧には出てこないはず
    const visibleIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-case-id]"))
        .filter((el) => el instanceof HTMLElement && el.offsetParent !== null)
        .map((el) => el.getAttribute("data-case-id"))
    );
    assert(!visibleIds.includes(idA), "SavedビューをONにするとTrashビューは自動的にOFFになる(排他)");
    await savedButton.click(); // 後片付け: Savedを閉じる
    await page.waitForTimeout(100);
    void trashViewButton;
  }

  // --- 6. 復元: Trashビューで「復元」をクリックすると通常一覧に戻る ---
  {
    const trashViewButton = page.getByRole("button", { name: /^Trash/ });
    await trashViewButton.click();
    await page.waitForTimeout(200);
    await page.locator(`[data-case-id="${idA}"] button[aria-label="復元"]`).click();
    await page.waitForTimeout(150);

    const trashRaw = await readKey(page, TRASH_KEY);
    const parsed = JSON.parse(trashRaw);
    assert(parsed?.items?.[idA]?.fav === false, "復元後、trashキーの当該idはfav:falseになる(tombstone)");

    await trashViewButton.click(); // Trashビューを閉じて通常一覧に戻す
    await page.waitForTimeout(200);
    const restoredCard = await page.locator(`[data-case-id="${idA}"]`).count();
    assert(restoredCard === 1, "復元後、カードは通常のTOP一覧に戻る");
  }

  await clearKeys(page);

  // --- 7. マイグレーション: trashキーでも旧形式(string[])からの移行がfactory共通ロジックとして働く ---
  await page.evaluate(
    ({ key, id }) => localStorage.setItem(key, JSON.stringify([id])),
    { key: TRASH_KEY, id: idB }
  );
  await page.reload();
  await waitForHydration(page);

  {
    const cardVisible = await page.locator(`[data-case-id="${idB}"]`).count();
    assert(cardVisible === 0, "trashキーの旧形式(string[])からのマイグレーションが機能し、該当カードが一覧から消える");
  }

  await clearKeys(page);
  await page.reload();
  await waitForHydration(page);

  // --- 8. サーバ応答マージ反映(/api/trashモック): favorites側と同じ配線がtrash側にもあることの確認 ---
  {
    let capturedPostBody = null;
    await page.route("**/api/trash", async (route) => {
      const req = route.request();
      if (req.method() !== "POST") return route.continue();
      capturedPostBody = JSON.parse(req.postData());
      // サーバ側で別デバイスからのごみ箱操作(idB)が既にマージされていた、という応答を模す
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version: 1,
          items: { [idB]: { fav: true, ts: Date.now() + 10_000 } },
        }),
      });
    });

    await page.locator(`[data-case-id="${idA}"] button[aria-label="ごみ箱に入れる"]`).click();
    assert(capturedPostBody === null, "toggle直後はまだPOSTが送信されていない(debounce)");
    await page.waitForTimeout(2200); // SYNC_DEBOUNCE_MS(1500ms)超待って送信・応答反映を待つ

    assert(
      !!capturedPostBody?.items?.[idA],
      "デバウンス後に/api/trashへPOSTが送信され、ローカルの差分がbodyに含まれる"
    );

    const finalRaw = await readKey(page, TRASH_KEY);
    const finalParsed = JSON.parse(finalRaw);
    assert(
      finalParsed?.items?.[idB]?.fav === true,
      "サーバ応答にのみ含まれていた別idのごみ箱状態がローカルへ反映される(双方向マージ)"
    );

    await page.unroute("**/api/trash");
  }

  await clearKeys(page);
  await browser.close();

  if (failures > 0) {
    console.error(`\n${failures} 件失敗`);
    process.exit(1);
  } else {
    console.log("\n全テストPASS: createSyncedIdSet (favorites/trash共通ファクトリ)");
  }
}

main().catch((err) => {
  console.error("smoke-synced-id-set failed to run:", err);
  process.exit(1);
});
