// お気に入りサーバ同期（バッチ1）のマージ/検証ロジックのスモークテスト。
// src/lib/favoritesMerge.ts はサーバ(route.ts)とクライアント(useFavorites.ts)の両方から
// 参照される純粋関数群。ネットワーク・Blobに依存しないため、ここで単体検証する
// （実際のBlob読み書きの検証は scripts/smoke-favorites-api.mjs 側で行う）。
// 実行: npx tsx scripts/smoke-favorites-merge.mjs
import {
  FAVORITE_ID_PATTERN,
  MAX_ID_LENGTH,
  MAX_ITEMS,
  validateIncomingItems,
  mergeFavoritesItems,
} from "../src/lib/favoritesMerge.ts";

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// --- id パターン ---
assert(FAVORITE_ID_PATTERN.test("even-realities-2026"), "実在するcase idの形式を許可する");
assert(FAVORITE_ID_PATTERN.test("comfyui-ttp-toolset-smart-tile-2-0"), "実在するtech idの形式を許可する");
assert(!FAVORITE_ID_PATTERN.test("../etc/passwd"), "パストラバーサル文字列を拒否する");
assert(!FAVORITE_ID_PATTERN.test("Foo-Bar"), "大文字を含むidを拒否する");
assert(!FAVORITE_ID_PATTERN.test("foo_bar"), "アンダースコアを含むidを拒否する");
assert(!FAVORITE_ID_PATTERN.test(""), "空文字を拒否する");

// --- validateIncomingItems: 正常系 ---
{
  const result = validateIncomingItems({
    items: { "even-realities-2026": { fav: true, ts: 1000 } },
  });
  assert(result.ok === true, "正常なitemsは受理される");
  if (result.ok) {
    assert(result.items["even-realities-2026"].fav === true, "受理されたitemsの値が保持される");
  }
}

// --- validateIncomingItems: 異常系 ---
assert(validateIncomingItems(null).ok === false, "bodyがnullなら拒否");
assert(validateIncomingItems([]).ok === false, "bodyが配列なら拒否");
assert(validateIncomingItems({}).ok === false, "itemsフィールドが無ければ拒否");
assert(
  validateIncomingItems({ items: { "bad id with space": { fav: true, ts: 1 } } }).ok === false,
  "不正な形式のidを拒否する"
);
assert(
  validateIncomingItems({ items: { ["a".repeat(MAX_ID_LENGTH + 1)]: { fav: true, ts: 1 } } }).ok === false,
  `id長がMAX_ID_LENGTH(${MAX_ID_LENGTH})を超えたら拒否する`
);
assert(
  validateIncomingItems({ items: { "valid-id": { fav: "yes", ts: 1 } } }).ok === false,
  "favが真偽値でなければ拒否する"
);
assert(
  validateIncomingItems({ items: { "valid-id": { fav: true, ts: "now" } } }).ok === false,
  "tsが数値でなければ拒否する"
);
assert(
  validateIncomingItems({ items: { "valid-id": { fav: true, ts: -1 } } }).ok === false,
  "tsが負数なら拒否する"
);
{
  const tooMany = {};
  for (let i = 0; i < MAX_ITEMS + 1; i++) tooMany[`id-${i}`] = { fav: true, ts: 1 };
  assert(
    validateIncomingItems({ items: tooMany }).ok === false,
    `件数がMAX_ITEMS(${MAX_ITEMS})を超えたら拒否する`
  );
}
{
  const exactly = {};
  for (let i = 0; i < MAX_ITEMS; i++) exactly[`id-${i}`] = { fav: true, ts: 1 };
  assert(
    validateIncomingItems({ items: exactly }).ok === true,
    `件数がちょうどMAX_ITEMS(${MAX_ITEMS})なら受理する`
  );
}

// --- mergeFavoritesItems: LWW（Last-Write-Wins） ---
{
  // incoming の ts が新しい → incoming が勝つ
  const current = { "id-a": { fav: true, ts: 100 } };
  const incoming = { "id-a": { fav: false, ts: 200 } };
  const merged = mergeFavoritesItems(current, incoming);
  assert(merged["id-a"].fav === false, "新しいtsを持つincomingが勝つ(fav)");
  assert(merged["id-a"].ts === 200, "新しいtsを持つincomingが勝つ(ts)");
}
{
  // incoming の ts が古い → current(サーバ側の既存値)が勝つ
  const current = { "id-a": { fav: true, ts: 200 } };
  const incoming = { "id-a": { fav: false, ts: 100 } };
  const merged = mergeFavoritesItems(current, incoming);
  assert(merged["id-a"].fav === true, "古いtsを持つincomingは負ける(fav)");
  assert(merged["id-a"].ts === 200, "古いtsを持つincomingは負ける(ts)");
}
{
  // ts同値 → incoming優先（決定的な挙動であることの確認。値そのものの正しさより
  // 「常に同じ結果になる」ことが重要）
  const current = { "id-a": { fav: true, ts: 100 } };
  const incoming = { "id-a": { fav: false, ts: 100 } };
  const merged = mergeFavoritesItems(current, incoming);
  assert(merged["id-a"].fav === false, "ts同値時はincomingを優先する(決定的挙動)");
}
{
  // current にのみ存在するidは保持される（tombstone含む。破壊不能マージの根幹）
  const current = { "id-a": { fav: true, ts: 100 }, "id-b": { fav: false, ts: 50 } };
  const incoming = { "id-a": { fav: false, ts: 200 } };
  const merged = mergeFavoritesItems(current, incoming);
  assert(merged["id-b"].fav === false && merged["id-b"].ts === 50, "incomingに無いidは消えず保持される(tombstone)");
}
{
  // incoming にのみ存在する新規id
  const current = {};
  const incoming = { "id-new": { fav: true, ts: 1 } };
  const merged = mergeFavoritesItems(current, incoming);
  assert(merged["id-new"].fav === true, "currentに無い新規idは追加される");
}
{
  // 元オブジェクトを破壊しない（純粋関数であることの確認）
  const current = { "id-a": { fav: true, ts: 100 } };
  const incoming = { "id-a": { fav: false, ts: 200 } };
  mergeFavoritesItems(current, incoming);
  assert(current["id-a"].fav === true && current["id-a"].ts === 100, "current引数を破壊しない");
}

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
} else {
  console.log("全テストPASS: favoritesMerge");
}
