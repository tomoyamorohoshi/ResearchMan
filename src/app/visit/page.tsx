import { exhibitionItems, todayJst } from "@/lib/exhibition";
import venueGeoJson from "../../../data/venue-geo.json";
import type { VenueGeo } from "@/lib/visit";
import VisitClient from "@/components/VisitClient";
import TopTabs from "@/components/TopTabs";

export const metadata = {
  title: "Visit | ResearchMan",
  description: "「行きたい」を押した展覧会を、地図と会期で見る",
};

// Next.js 16: searchParams は Promise
export default async function VisitPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const view = sp.view === "calendar" ? "calendar" : "bars";
  return (
    <main className="min-h-screen">
      <header className="border-b border-gray-300 px-4 py-4 max-w-[1600px] mx-auto flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 leading-none">ResearchMan</h1>
          <p className="text-[10px] tracking-[0.25em] uppercase text-gray-400 mt-1">Visit Plan</p>
        </div>
      </header>

      <div className="border-b border-gray-300 bg-[#eeece7]">
        <TopTabs active="visit" />
      </div>

      <VisitClient
        items={exhibitionItems}
        geo={venueGeoJson as unknown as VenueGeo}
        initialToday={todayJst()}
        initialView={view}
      />
    </main>
  );
}
