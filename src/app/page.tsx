import { cases, allCategories, allYears, allRegions } from "@/lib/cases";
import GalleryClient from "@/components/GalleryClient";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-10">
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            🌐 CREATIVE EDGE
          </h1>
          <p className="text-gray-500 text-sm">
            Cannes Lions / D&AD / Clio / ACC — 世界と国内のクリエイティブ事例アーカイブ
          </p>
        </div>

        <GalleryClient
          cases={cases}
          categories={allCategories}
          years={allYears}
          regions={allRegions}
        />
      </div>
    </main>
  );
}
