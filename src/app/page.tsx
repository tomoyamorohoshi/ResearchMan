import { cases, allCategories, allYears, allRegions, allSources, allTags } from "@/lib/cases";
import GalleryClient from "@/components/GalleryClient";
import TopTabs from "@/components/TopTabs";
import { ViewModeProvider } from "@/components/ViewModeContext";
import ViewModeToggle from "@/components/ViewModeToggle";
import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen">
      <ViewModeProvider>
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
          <div className="flex items-end gap-3">
            <nav className="text-[9px] tracking-widest uppercase text-gray-400 text-right leading-relaxed hidden sm:flex flex-wrap justify-end gap-x-2 gap-y-0.5">
              {[
                { href: "/awards/cannes", label: "Cannes Lions" },
                { href: "/awards/dad",    label: "D&AD"         },
                { href: "/awards/clio",   label: "Clio"         },
                { href: "/awards/acc",    label: "ACC"          },
                { href: "/awards/spikes", label: "Spikes Asia"  },
              ].map((item, i, arr) => (
                <span key={item.href} className="flex items-center gap-x-2">
                  <Link
                    href={item.href}
                    className="hover:text-gray-900 transition-colors"
                  >
                    {item.label}
                  </Link>
                  {i < arr.length - 1 && <span className="text-gray-300">/</span>}
                </span>
              ))}
            </nav>
            <ViewModeToggle />
          </div>
        </header>

        {/* Case Study / Technology 大分類タブ */}
        <div className="border-b border-gray-300 bg-[#eeece7]">
          <TopTabs active="cases" />
        </div>

        <GalleryClient
          cases={cases}
          categories={allCategories}
          years={allYears}
          regions={allRegions}
          sources={allSources}
          tags={allTags}
        />
      </ViewModeProvider>
    </main>
  );
}
