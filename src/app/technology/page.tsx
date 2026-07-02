import { techItems, TECH_TYPES, allDomains, allTechYears } from "@/lib/tech";
import TechGalleryClient from "@/components/TechGalleryClient";
import TopTabs from "@/components/TopTabs";

export const metadata = {
  title: "Technology | ResearchMan",
  description:
    "AI・HCI・CG・先端メディアテクノロジーの研究・プロトタイプ・ツールを国内外から収集するアーカイブ",
};

export default function TechnologyPage() {
  return (
    <main className="min-h-screen">
      {/* ヘッダー */}
      <header className="border-b border-gray-300 px-4 py-4 max-w-[1600px] mx-auto flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 leading-none">
            ResearchMan
          </h1>
          <p className="text-[10px] tracking-[0.25em] uppercase text-gray-400 mt-1">
            Technology Archive
          </p>
        </div>
        <p className="text-[9px] tracking-widest uppercase text-gray-400 text-right leading-relaxed hidden sm:block">
          Research / Prototype / Tool
        </p>
      </header>

      {/* Case Study / Technology 大分類タブ */}
      <div className="border-b border-gray-300 bg-[#eeece7]">
        <TopTabs active="tech" />
      </div>

      <TechGalleryClient
        items={techItems}
        types={TECH_TYPES}
        domains={allDomains}
        years={allTechYears}
      />
    </main>
  );
}
