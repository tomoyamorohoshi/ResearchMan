// お気に入りサーバ同期（バッチ1）導入に伴うUI回帰テスト。
// useFavorites.ts の内部データ形式が string[] → {version:1, items:{...}} へ変わるが、
// 外部から見える挙動（★トグル・Savedフィルタ・リロード後の永続化）は現状と同一である
// ことをPlaywrightで実ブラウザ操作により確認する。あわせて、旧形式(string[])からの
// マイグレーションが正しく行われることも検証する。
// 実行: PORT=3111 npx next dev の後、npx tsx scripts/smoke-favorites-ui.mjs
import { chromium } from "playwright";

const BASE_URL = process.env.FAVORITES_UI_SMOKE_URL || "http://localhost:3111";
const STORAGE_KEY = "creative-edge-favorites";

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

// useSyncExternalStoreはSSR直後、クライアントの実スナップショットと照合するための
// 追加レンダーパスをハイドレーション完了後に行う。waitForSelector はSSR済みDOMの出現だけで
// resolveしてしまいハイドレーション前の状態を見てしまうことがあるため、goto/reload後は
// 明示的に少し待ってからDOM状態を読む
async function waitForHydration(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // --- 1. マイグレーション: 旧形式(string[])を事前に仕込んでから読み込む ---
  await page.goto(BASE_URL);
  await waitForHydration(page);
  const legacyId = await page.evaluate(() => {
    const firstCard = document.querySelector("[data-case-id]");
    return firstCard ? firstCard.getAttribute("data-case-id") : null;
  });
  assert(typeof legacyId === "string" && legacyId.length > 0, "ページ上に最低1件のケースカードが存在する");

  await page.evaluate(
    ({ key, id }) => {
      localStorage.setItem(key, JSON.stringify([id]));
    },
    { key: STORAGE_KEY, id: legacyId }
  );
  await page.reload();
  await waitForHydration(page);

  const legacyStar = page.locator(`[data-case-id="${legacyId}"] button[aria-label="お気に入りを解除"]`);
  assert((await legacyStar.count()) === 1, "旧形式(string[])で登録済みのidがマイグレーション後も★状態で表示される");

  const migratedRaw = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  // マイグレーション自体は次のtoggleまでlocalStorageへ書き戻さない設計（getSnapshot内の
  // 副作用回避のため）なので、この時点ではまだ旧形式のままであることを確認する
  let migratedParsed;
  try {
    migratedParsed = JSON.parse(migratedRaw);
  } catch {
    migratedParsed = null;
  }
  assert(Array.isArray(migratedParsed), "toggle前はlocalStorageがまだ旧形式(配列)のままである(設計どおり)");

  // --- 2. トグルで新形式へ書き戻る ---
  await legacyStar.click();
  await page.waitForTimeout(200);
  const afterToggleOffRaw = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  let afterToggleOff;
  try {
    afterToggleOff = JSON.parse(afterToggleOffRaw);
  } catch {
    afterToggleOff = null;
  }
  assert(
    afterToggleOff && afterToggleOff.version === 1 && typeof afterToggleOff.items === "object",
    "1回toggleするとlocalStorageが新形式{version:1,items:{...}}へ書き換わる"
  );
  assert(
    !!afterToggleOff?.items?.[legacyId] && afterToggleOff.items[legacyId].fav === false,
    "解除トグル後、該当idはfav:falseとして残る(tombstone)"
  );
  assert(
    typeof afterToggleOff?.items?.[legacyId]?.ts === "number",
    "各itemにts(数値)が付与される"
  );

  // 解除された（★が消えた）ことをUIでも確認
  const unfavoritedButton = page.locator(`[data-case-id="${legacyId}"] button[aria-label="お気に入りに追加"]`);
  assert((await unfavoritedButton.count()) === 1, "解除トグル後、★ボタンのaria-labelが「お気に入りに追加」に戻る");

  // --- 3. 再度トグルしてお気に入り登録 → Savedフィルタ・リロード永続 ---
  await unfavoritedButton.click();
  await page.waitForTimeout(200);
  const refavoritedButton = page.locator(`[data-case-id="${legacyId}"] button[aria-label="お気に入りを解除"]`);
  assert((await refavoritedButton.count()) === 1, "再トグルで★が付いた状態に戻る");

  const savedFilterButton = page.getByRole("button", { name: /^Saved/ });
  await savedFilterButton.click();
  await page.waitForTimeout(200);
  const visibleCaseIds = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("[data-case-id]"))
      .filter((el) => el instanceof HTMLElement && el.offsetParent !== null)
      .map((el) => el.getAttribute("data-case-id"));
  });
  assert(
    visibleCaseIds.length === 1 && visibleCaseIds[0] === legacyId,
    `Savedフィルタで対象カード(${legacyId})のみ表示される (got ${JSON.stringify(visibleCaseIds)})`
  );

  // フィルタを解除してから、リロードしても状態が保持されるか確認
  await savedFilterButton.click();
  await page.reload();
  await waitForHydration(page);
  const persistedButton = page.locator(`[data-case-id="${legacyId}"] button[aria-label="お気に入りを解除"]`);
  assert((await persistedButton.count()) === 1, "リロード後も★状態がlocalStorageから復元され保持される");

  // --- 4. 後片付け: テストで作ったお気に入り状態を除去 ---
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);

  // --- 5. サーバ同期のレスポンス反映（実Blobなしでモックして検証） ---
  // POST /api/favorites を横取りし、200 + マージ済みitems を模した応答を返す。
  // useFavorites.ts がレスポンスをLWWマージしてlocalStorageへ反映する経路
  // （favoritesMerge.tsの単体テストではカバーされない、fetch応答処理の配線部分）を検証する
  await page.reload();
  await waitForHydration(page);
  const otherId = await page.evaluate(
    (excludeId) =>
      Array.from(document.querySelectorAll("[data-case-id]"))
        .map((el) => el.getAttribute("data-case-id"))
        .find((id) => id !== excludeId),
    legacyId
  );
  assert(typeof otherId === "string" && otherId.length > 0, "モックテスト用に2件目のcase idが取得できる");

  let capturedPostBody = null;
  await page.route("**/api/favorites", async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.continue();
    capturedPostBody = JSON.parse(req.postData());
    // サーバ側で別デバイスからの新規お気に入り(otherId)と、より新しいtsで上書きされた
    // legacyIdの解除(fav:false)が既にマージされていた、という応答を模す
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: 1,
        items: {
          [otherId]: { fav: true, ts: Date.now() + 10_000 },
          [legacyId]: { fav: false, ts: Date.now() + 10_000 },
        },
      }),
    });
  });

  await page.locator(`[data-case-id="${legacyId}"] button[aria-label="お気に入りに追加"]`).click();
  assert(capturedPostBody === null, "toggle直後はまだPOSTが送信されていない(debounce)");
  await page.waitForTimeout(2200); // SYNC_DEBOUNCE_MS(1500ms)超待って送信・応答反映を待つ

  assert(
    !!capturedPostBody?.items?.[legacyId],
    "デバウンス後にPOSTが送信され、ローカルの差分がbodyに含まれる"
  );

  const finalRaw = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  const finalParsed = JSON.parse(finalRaw);
  assert(
    finalParsed?.items?.[otherId]?.fav === true,
    "サーバ応答にのみ含まれていた別idのお気に入りがローカルへ反映される(双方向マージ)"
  );
  assert(
    finalParsed?.items?.[legacyId]?.fav === false,
    "サーバ側のより新しいtsがローカルの楽観更新を正しく上書きする(LWW)"
  );

  await page.unroute("**/api/favorites");
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);

  // --- 6. マイグレーション由来のtsが、他デバイスの「本物の解除」を復活させないことの確認 ---
  // (adversarial-reviewer 指摘の再発防止テスト)
  // 旧形式(string[])からの移行id(migratedId)は ts=MIGRATED_LEGACY_TS(番兵値) を持つ。
  // サーバが「別デバイスで実際に解除された(ts=実時刻>0, fav:false)」という応答を返した場合、
  // 移行由来の楽観的なfav:trueで上書きしてしまってはいけない（意図的な解除の復活を防ぐ）。
  await page.reload();
  await waitForHydration(page);
  const [migratedId, toggleTargetId] = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-case-id]"))
      .slice(0, 2)
      .map((el) => el.getAttribute("data-case-id"))
  );
  assert(
    typeof migratedId === "string" && typeof toggleTargetId === "string" && migratedId !== toggleTargetId,
    "マイグレーション復活防止テスト用に異なる2件のcase idが取得できる"
  );

  await page.evaluate(
    ({ key, id }) => localStorage.setItem(key, JSON.stringify([id])),
    { key: STORAGE_KEY, id: migratedId }
  );
  await page.reload();
  await waitForHydration(page);

  let resurrectionTestBody = null;
  await page.route("**/api/favorites", async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.continue();
    resurrectionTestBody = JSON.parse(req.postData());
    // 「別デバイスが実時刻ts=1000でmigratedIdを本物の解除をした」という応答を模す
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: 1,
        items: { [migratedId]: { fav: false, ts: 1000 } },
      }),
    });
  });

  // migratedId自体はtoggleしない。別のid(toggleTargetId)をtoggleして、その際の
  // フルスナップショットPOSTにmigratedId(ts=MIGRATED_LEGACY_TS)が乗ることを利用する
  await page.locator(`[data-case-id="${toggleTargetId}"] button[aria-label="お気に入りに追加"]`).click();
  await page.waitForTimeout(2200);

  assert(
    resurrectionTestBody?.items?.[migratedId]?.ts === 0,
    `マイグレーション由来idはts=0としてサーバへ送信される (got ${JSON.stringify(resurrectionTestBody?.items?.[migratedId])})`
  );

  const resurrectionRaw = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  const resurrectionParsed = JSON.parse(resurrectionRaw);
  assert(
    resurrectionParsed?.items?.[migratedId]?.fav === false,
    "サーバ側の本物の解除(ts=1000>0)がマイグレーション由来のfav:true(ts=0)を上書きし、復活しない"
  );

  await page.unroute("**/api/favorites");
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);

  await browser.close();

  if (failures > 0) {
    console.error(`\n${failures} 件失敗`);
    process.exit(1);
  } else {
    console.log("\n全テストPASS: favorites UI regression");
  }
}

main().catch((err) => {
  console.error("smoke-favorites-ui failed to run:", err);
  process.exit(1);
});
