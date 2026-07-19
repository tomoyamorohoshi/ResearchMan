import { notFound } from "next/navigation";
import Link from "next/link";
import { AWARD_ORGS, getAwardCollections, getOrgByKey, type OrgKey } from "@/lib/awards";

export function generateStaticParams() {
  return AWARD_ORGS.map(o => ({ org: o.key }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const orgDef = getOrgByKey(org);
  return { title: `${orgDef?.label ?? org} — ResearchMan` };
}

export default async function AwardOrgPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const orgDef = getOrgByKey(org);
  if (!orgDef) notFound();

  const collections = getAwardCollections(org as OrgKey);

  // Group by year for display
  const byYear = new Map<string, typeof collections>();
  for (const col of collections) {
    if (!byYear.has(col.year)) byYear.set(col.year, []);
    byYear.get(col.year)!.push(col);
  }
  const years = Array.from(byYear.keys()).sort((a, b) => Number(b) - Number(a));

  return (
    <div className="min-h-screen bg-[#eeece7]">
      <header className="border-b border-gray-300 px-4 py-4 max-w-[1600px] mx-auto flex items-center gap-6">
        <Link href="/" className="text-xl font-black tracking-tight text-gray-900 leading-none">
          ResearchMan
        </Link>
        <Link
          href="/"
          className="text-[9px] tracking-[0.25em] uppercase text-gray-400 hover:text-gray-900 transition-colors"
        >
          ← Archive
        </Link>
      </header>

      <div className="max-w-[1600px] mx-auto px-4 py-10">
        <div className="mb-10">
          <p className="text-[9px] tracking-[0.3em] uppercase text-gray-400 mb-1">Awards Archive</p>
          <h1 className="text-4xl font-black tracking-tight text-gray-900">{orgDef.label}</h1>
          <p className="text-[10px] tracking-widest text-gray-400 mt-2 uppercase">
            {collections.length} collections · {collections.reduce((s, c) => s + c.cases.length, 0)} cases
          </p>
        </div>

        <div className="space-y-10">
          {years.map(year => (
            <section key={year}>
              <div className="border-t-2 border-gray-900 pt-2 mb-4">
                <span className="text-[11px] tracking-[0.3em] uppercase font-bold text-gray-900">
                  {year}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-gray-300">
                {byYear.get(year)!.map(col => (
                  <Link
                    key={col.slug}
                    href={`/awards/${org}/${col.slug}`}
                    className="bg-[#eeece7] p-5 group flex items-start justify-between gap-4 hover:bg-gray-100 transition-colors"
                  >
                    <div>
                      <p className="text-[9px] tracking-[0.25em] uppercase text-gray-400 mb-1">{year}</p>
                      <p className="text-base font-bold text-gray-900 group-hover:underline underline-offset-2 leading-snug">
                        {col.category}
                      </p>
                    </div>
                    <span className="text-[10px] tracking-widest text-gray-400 shrink-0 pt-1">
                      {col.cases.length}件 →
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>

        {collections.length === 0 && (
          <p className="text-[10px] tracking-[0.3em] uppercase text-gray-400 py-20 text-center">
            No entries found
          </p>
        )}
      </div>
    </div>
  );
}
