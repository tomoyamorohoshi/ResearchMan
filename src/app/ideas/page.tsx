import { sortedIdeas } from "@/lib/ideas";
import IdeaCard from "@/components/IdeaCard";
import TopTabs from "@/components/TopTabs";

export const metadata = {
  title: "Ideas | ResearchMan",
  description:
    "毎朝配信している「アイデアの種」（Case Study × Technology の掛け合わせ）のアーカイブ",
};

export default function IdeasPage() {
  return (
    <main className="min-h-screen">
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-gray-300 max-w-[1600px] mx-auto">
        {sortedIdeas.map((idea) => (
          <IdeaCard key={idea.id} idea={idea} />
        ))}
      </div>
    </main>
  );
}
