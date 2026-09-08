// scripts/auto-research-cc.mjs の toId() 単体検証。
//
// 背景: data/cases.json に日本語タイトルの事例が case-18fe8km-2026 のような無意味なハッシュID
// で追加される問題があった。原因は toId() の \w（ASCII限定）による slug 化で日本語が全て
// 落ちること、さらに client も日本語のみだとフォールバック先が無くハッシュに直行すること。
// TDD: 実装前にこのテストを書き、失敗を確認してから toId() を修正した。
//
// 実行: node scripts/smoke-auto-research-cc-toid.mjs
import { toId, dedupeId } from "./auto-research-cc.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

// ── 1. 英語タイトル → 従来と完全に同じIDになる（回帰防止。data/cases.json実データ照合） ──
{
  const casesPath = path.join(__dirname, "../data/cases.json");
  const cases = JSON.parse(fs.readFileSync(casesPath, "utf-8"));
  const englishTitledFixtures = [
    "#WarOnWhatsHidden",
    "FEED IT",
    "TCG Card Shop Simulator 正式リリース決定（Switch/PS5同時発売）",
  ];
  let checked = 0;
  for (const title of englishTitledFixtures) {
    const c = cases.find((x) => x.title === title);
    assert(!!c, `data/cases.jsonにフィクスチャ「${title}」が実在する`);
    if (!c) continue;
    const id = toId(c.title, c.year, c.client, c.link);
    assert(id === c.id, `英語タイトル「${title}」: toId()の出力(${id})が既存ID(${c.id})と一致する`);
    checked++;
  }
  assert(checked >= 3, `英語タイトルの回帰確認を${checked}件で実施した（3件以上）`);
}

// ── 4. client指定時の従来挙動（日本語タイトル + ラテン文字clientでclientSlugを使う） ──
{
  // data/cases.json実データ: タイトル全角日本語・client="Tokisaka"（ラテン文字）
  const id = toId("限界ライバー しめきり1週前", "2026", "Tokisaka", "https://example.com/x/1");
  assert(id === "tokisaka-2026", `日本語タイトル+ラテン文字clientは従来どおりclientSlugを使う（実際: ${id}）`);
}

// ── 2. 日本語のみのタイトル（clientも日本語のみだが、実運用どおりソースURLはある） →
//       ハッシュではなく人間可読なIDになる ──
{
  const id = toId("戦争と平和の物語をめぐる展示企画", "2026", "朝日新聞社", "https://www.example.co.jp/news/12345");
  assert(!/^case-[a-z0-9]+-2026$/.test(id), `ソースURLがあればハッシュ(case-xxxxx-年)にならない（実際: ${id}）`);
}

// ── 3. 日本語タイトル＋ラテン文字ブランド名混在 → ブランド名が活きる ──
{
  const id = toId("日本語のタイトルの中にNikeというブランド名が入っている", "2026", "");
  assert(id === "nike-2026", `タイトル埋め込みのラテン文字ブランド名(Nike)がIDに使われる（実際: ${id}）`);
}

// ── 6. 実在の失敗例（「戦争と平和」紙面×書店展開）が case-18fe8km 形式にならない ──
{
  const title = "「戦争と平和」紙面×書店展開（『戦後』が終わり『新しい戦前』になりつつある時代に）";
  const client = "朝日新聞社"; // 実データ上もclientは日本語のみでラテン文字を含まない
  const link = "https://www.advertimes.com/20260815/article553794/";
  const id = toId(title, "2026", client, link);
  assert(id !== "18fe8km-2026" && !/^case-[a-z0-9]{5,9}-2026$/.test(id), `実在の失敗例がハッシュID形式にならない（実際: ${id}）`);
  assert(id.startsWith("advertimes"), `ソースURLのドメインを使った人間可読IDになる（実際: ${id}）`);
}

// ── 5. 同一年に衝突しうる入力で一意性が保たれる（同一ドメイン・異なる記事ID） ──
{
  const idA = toId("日本語だけのタイトルA", "2026", "", "https://bijutsutecho.com/magazine/news/exhibition/32901");
  const idB = toId("日本語だけのタイトルB", "2026", "", "https://bijutsutecho.com/magazine/news/exhibition/40123");
  assert(idA !== idB, `同一ドメイン・異なる記事パスなら異なるIDになる（衝突しない）: ${idA} / ${idB}`);
  assert(idA === "bijutsutecho-32901-2026", `ドメイン+記事パスの人間可読IDが期待どおり（実際: ${idA}）`);
}

// ── URLも手掛かりも一切ない場合は最終手段としてハッシュのまま（機能維持の確認） ──
{
  const id = toId("純粋な日本語タイトルのみで手掛かりゼロ", "2026", "");
  assert(/^case-[a-z0-9]+-2026$/.test(id), `手掛かりが本当に何もない場合は最終手段のハッシュにフォールバックする（実際: ${id}）`);
}

// ── 2026-08-19レビュー指摘の回帰テスト ──────────────────────────────

// ── 指摘4: percent-encodeされた日本語パスはdecodeURIComponentしてから非ASCIIを除去する
//    （デコードしないと16進の羅列がIDに残る）。日本語オンリーのパスは捨てて前段パスへ ──
{
  // パス末尾が日本語オンリー（デコード後もASCII英数字が残らない）→ 手前のパスセグメントを使う
  const id1 = toId("日本語だけのタイトル", "2026", "", "https://example.co.jp/news/%E5%B1%95%E7%A4%BA%E4%BC%9A/12345");
  assert(id1 === "example-12345-2026", `percent-encode日本語パスはデコード後に捨てて手前のパスを使う（実際: ${id1}）`);
  // 全パスセグメントが日本語オンリー → ドメインのみにフォールバック（16進の羅列にならない）
  const id2 = toId("日本語だけのタイトル", "2026", "", "https://example.co.jp/%E3%83%8B%E3%83%A5%E3%83%BC%E3%82%B9/%E8%A8%98%E4%BA%8B");
  assert(!/[0-9a-f]{2}-[0-9a-f]{2}/.test(id2), `percent-encode日本語パスが全滅しても16進の羅列にならない（実際: ${id2}）`);
  assert(id2 === "example-2026", `全パスが日本語オンリーならドメインのみにフォールバックする（実際: ${id2}）`);
}

// ── 指摘5: URLのパス中のアンダースコアはハイフンへ変換/除去され、
//    お気に入り同期のID検証パターン(/^[a-z0-9]+(-[a-z0-9]+)*$/)を満たす ──
{
  const id = toId("日本語だけのタイトル", "2026", "", "https://example.jp/news_detail/12_345");
  assert(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id), `URL由来IDにアンダースコアが残らずFAVORITE_ID_PATTERNを満たす（実際: ${id}）`);
  assert(!id.includes("_"), `URL由来IDにアンダースコアが残らない（実際: ${id}）`);
}
// 既存の英語タイトル経路（メインのslugOf）は変更していないことの回帰確認。
// アンダースコア入りタイトルの実例はdata/cases.jsonに存在しないため純関数フィクスチャで確認する。
{
  const id = toId("A_B_C Something Title", "2026", "");
  assert(id === "a_b_c-something-title-2026", `英語タイトル経路（slugOf）のアンダースコア扱いは変更していない（実際: ${id}）`);
}

// ── 指摘3: サブドメイン付きURLでもレジスタード・ドメインのラベルが人間可読になる ──
{
  const id1 = toId("日本語だけのタイトルC", "2026", "", "https://jp.mercari.com/item/m123456789");
  assert(id1.startsWith("mercari-"), `一般サブドメイン(jp.)はブランド名の抽出に影響しない（実際: ${id1}）`);
  const id2 = toId("日本語だけのタイトルD", "2026", "", "https://blog.hoge.co.jp/entry/2026/08/19/999");
  assert(id2.startsWith("hoge-"), `co.jp等の複合TLDでもTLD直前のラベル(hoge)を拾う（実際: ${id2}）`);
}

// ── 指摘2: パスセグメントが短い/数字のみでもクエリパラメータから拾える ──
{
  const idA = toId("日本語だけのタイトルE", "2026", "", "https://example.jp/a/1?id=1111");
  const idB = toId("日本語だけのタイトルF", "2026", "", "https://example.jp/a/1?id=2222");
  // パスセグメント "1" は2文字未満（length<2）なので使われず、クエリのid値が使われる
  assert(idA !== idB, `パスが短くてもクエリパラメータの値で一意化できる: ${idA} / ${idB}`);
  assert(idA.includes("1111") && idB.includes("2222"), `クエリパラメータの値がIDに反映される（実際: ${idA} / ${idB}）`);
}

// ── 指摘6: toId()内の「タイトル/client双方が失敗した後」のフォールバック段（urlSlug →
//    titleToken → clientToken → hash）では、URL由来を最優先にした（既存テストの英語回帰を
//    壊さないことは冒頭の回帰確認3件およびNikeテストで確認済み）。
//    ただし実際に確認したところ、"Instagram"のようなラテン文字トークンが埋め込まれたタイトルは
//    base=slugOf(title)の時点（フォールバック段に入るより前の主判定）で非digit文字数>=3を満たし
//    メイン分岐で確定してしまうため、この特定シナリオではフォールバック段の優先順位変更は
//    実質到達しない（構造上、そこに来る前に確定する）。したがってこの種の衝突（同一の一般語だけ
//    が埋め込まれた別タイトル）に対する実際の保護は優先順位の入れ替えではなく、後述のdedupeId()
//    による最終ID空間での一意化が担う。以下でそれを実測する。 ──
{
  const idA = toId("日本語のタイトルにInstagramという一般的な単語が含まれる展示企画（前期）", "2026", "");
  const idB = toId("日本語のタイトルにInstagramという一般的な単語が含まれる展示企画（後期）", "2026", "");
  assert(idA === idB, `【既知の構造的限界】メイン分岐で確定するため一般語埋め込みタイトル同士はtoId()単体では同一IDになる（${idA} / ${idB}）`);
  const existingIds = new Set([idA]);
  const idBDeduped = existingIds.has(idB) ? dedupeId(idB, existingIds) : idB;
  assert(idBDeduped !== idA, `上記の衝突はdedupeId()適用（呼び出し側の運用）で最終的に一意化される（実際: ${idBDeduped}）`);
}

// ── 指摘1: dedupeId() — 既存ID集合と衝突したら -2, -3... で一意化する ──
{
  const existingIds = new Set(["setouchi-artfest-artworks-artists-2010"]);
  const id1 = dedupeId("setouchi-artfest-artworks-artists-2010", existingIds);
  assert(id1 === "setouchi-artfest-artworks-artists-2-2010", `衝突時は年の直前に-2を挿入する（実際: ${id1}）`);
  existingIds.add(id1);
  const id2 = dedupeId("setouchi-artfest-artworks-artists-2010", existingIds);
  assert(id2 === "setouchi-artfest-artworks-artists-3-2010", `2重衝突時は-3まで進む（実際: ${id2}）`);
  const idFresh = dedupeId("brand-new-id-2026", existingIds);
  assert(idFresh === "brand-new-id-2026", `衝突がなければそのまま返す（実際: ${idFresh}）`);
}

// ── 指摘1: data/cases.json全件を新規追加シミュレーションした場合、最終ID空間で衝突がゼロになる ──
{
  const casesPath = path.join(__dirname, "../data/cases.json");
  const cases = JSON.parse(fs.readFileSync(casesPath, "utf-8"));
  const existingIds = new Set();
  const finalIds = [];
  for (const c of cases) {
    const rawId = toId(c.title, c.year, c.client, c.link);
    const id = existingIds.has(rawId) ? dedupeId(rawId, existingIds) : rawId;
    existingIds.add(id);
    finalIds.push(id);
  }
  const uniqueCount = new Set(finalIds).size;
  assert(
    uniqueCount === finalIds.length,
    `data/cases.json全${finalIds.length}件をtoId()+dedupeId()で再生成しても最終ID空間の衝突がゼロ（ユニーク数: ${uniqueCount}）`
  );
}

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
} else {
  console.log("\n全テストPASS: auto-research-cc-toid");
}
