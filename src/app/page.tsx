import { cases, allCategories, allYears, allRegions } from "@/lib/cases";
import GalleryClient from "@/components/GalleryClient";

export default function Home() {
  return (
    <main className="min-h-screen">
      {/* ヘッダー */}
      <header className="border-b border-gray-300 px-4 py-4 max-w-[1600px] mx-auto flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 leading-none">
            ResearchMan
          </h1>
          <p className="text-[10px] tracking-[0.25em] uppercase text-gray-400 mt-1">
            Creative Case Archive
          </p>
        </div>
        <p className="text-[9px] tracking-widest uppercase text-gray-400 text-right leading-relaxed hidden sm:block">
          Cannes Lions / D&amp;AD<br />
          Clio / ACC / Spikes Asia
        </p>
      </header>

      <GalleryClient
        cases={cases}
        categories={allCategories}
        years={allYears}
        regions={allRegions}
      />
    </main>
  );
}
