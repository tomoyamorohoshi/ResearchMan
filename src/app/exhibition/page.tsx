import { exhibitionItems, visibleExhibitions, todayJst, EXHIBITION_TAGS } from "@/lib/exhibition";
import ExhibitionGalleryClient from "@/components/ExhibitionGalleryClient";
import ExhibitionIntakeBox from "@/components/ExhibitionIntakeBox";
import TopTabs from "@/components/TopTabs";

export const metadata = {
  title: "Exhibition | ResearchMan",
  description: "メディアアート・インスタレーション・デザインなど、日本全国の開催中／開催前の展覧会アーカイブ",
};

export default function ExhibitionPage() {
  // 初期描画はサーバ計算の今日(JST)で ended を除外（クライアントが mount 後に再計算する）
  const initialToday = todayJst();
  const items = visibleExhibitions(exhibitionItems, initialToday);
  return (
    <main className="min-h-screen">
      <header className="border-b border-gray-300 px-4 py-4 max-w-[1600px] mx-auto flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 leading-none">ResearchMan</h1>
          <p className="text-[10px] tracking-[0.25em] uppercase text-gray-400 mt-1">Exhibition Archive</p>
        </div>
        <p className="text-[9px] tracking-widest uppercase text-gray-400 text-right leading-relaxed hidden sm:block">
          Ongoing / Upcoming
        </p>
      </header>

      <div className="border-b border-gray-300 bg-[#eeece7]">
        <TopTabs active="exhibition" />
      </div>

      <ExhibitionIntakeBox />

      <ExhibitionGalleryClient items={items} initialToday={initialToday} tagVocabulary={EXHIBITION_TAGS} />
    </main>
  );
}
