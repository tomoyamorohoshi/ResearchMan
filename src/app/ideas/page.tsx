import { techItems } from "@/lib/tech";
import IdeasPoster from "@/components/IdeasPoster";
import TopTabs from "@/components/TopTabs";

// アイデア→カテゴリ導出用のtech.json id→domains[0]対応表。
// IdeasPosterはいいね/ゴミ箱機能(hooks)を持つためClient Componentになった。
// Server ComponentからClient Componentへは、MapではなくシリアライズOKなタプル配列で渡す
// （IdeasPoster.tsx側でMapへ復元する）
const techDomainEntries: [string, string][] = techItems.map((t) => [t.id, t.domains[0]]);

export const metadata = {
  title: "Ideas | ResearchMan",
  description:
    "毎朝配信している「アイデアの種」（Case Study × Technology の掛け合わせ）のアーカイブ",
};

export default function IdeasPage() {
  return (
    // overflow-x-hidden: ポスターのカードはhover/rotateでわずかに軸交差矩形が視覚上の境界から
    // はみ出すことがある（回転した矩形は見た目上の外接矩形が広がるため）。デザインはそのままに
    // 水平スクロールバーの発生だけを防ぐ安全策
    <main className="min-h-screen overflow-x-hidden">
      {/* ヘッダー（TOP/Technologyと同じ構成） */}
      <header className="border-b border-gray-300 px-4 py-4 max-w-[1600px] mx-auto flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 leading-none">
            ResearchMan
          </h1>
          <p className="text-[10px] tracking-[0.25em] uppercase text-gray-400 mt-1">
            Idea Seeds Archive
          </p>
        </div>
        <p className="text-[9px] tracking-widest uppercase text-gray-400 text-right leading-relaxed hidden sm:block">
          Case Study × Technology
        </p>
      </header>

      {/* Case Study / Technology / Ideas 大分類タブ */}
      <div className="border-b border-gray-300 bg-[#eeece7]">
        <TopTabs active="ideas" />
      </div>

      <IdeasPoster techDomainEntries={techDomainEntries} />
    </main>
  );
}
