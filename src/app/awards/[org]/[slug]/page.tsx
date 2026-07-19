import { notFound } from "next/navigation";
import Link from "next/link";
import { AWARD_ORGS, getAwardCollections, getCollectionBySlug, getOrgByKey, type OrgKey } from "@/lib/awards";
import GalleryClient from "@/components/GalleryClient";

export function generateStaticParams() {
  const params: { org: string; slug: string }[] = [];
  for (const org of AWARD_ORGS) {
    for (const col of getAwardCollections(org.key)) {
      params.push({ org: org.key, slug: col.slug });
    }
  }
  return params;
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ org: string; slug: string }> }) {
  const { org, slug } = await params;
  const col = getCollectionBySlug(org as OrgKey, slug);
  const orgDef = getOrgByKey(org);
  return {
    title: col
      ? `${col.label} — ${orgDef?.label} — ResearchMan`
      : "Not Found — ResearchMan",
  };
}

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ org: string; slug: string }>;
}) {
  const { org, slug } = await params;
  const orgDef = getOrgByKey(org);
  if (!orgDef) notFound();

  const col = getCollectionBySlug(org as OrgKey, slug);
  if (!col) notFound();

  const years = Array.from(new Set(col.cases.map(c => c.year))).sort((a, b) => Number(b) - Number(a));
  const categories = Array.from(new Set(col.cases.flatMap(c => c.categories))).sort();
  const regions = Array.from(new Set(col.cases.flatMap(c => c.regions))).sort();

  return (
    <div className="min-h-screen bg-[#eeece7]">
      <header className="border-b border-gray-300 px-4 py-4 max-w-[1600px] mx-auto flex items-center gap-6">
        <Link href="/" className="text-xl font-black tracking-tight text-gray-900 leading-none">
          ResearchMan
        </Link>
        <Link
          href={`/awards/${org}`}
          className="text-[9px] tracking-[0.25em] uppercase text-gray-400 hover:text-gray-900 transition-colors"
        >
          ← {orgDef.label}
        </Link>
      </header>

      <div className="max-w-[1600px] mx-auto px-4 pt-8 pb-4">
        <p className="text-[9px] tracking-[0.3em] uppercase text-gray-400 mb-1">
          {orgDef.label}
        </p>
        <h1 className="text-3xl font-black tracking-tight text-gray-900">
          {col.year} — {col.category}
        </h1>
        <p className="text-[10px] tracking-widest text-gray-400 mt-2 uppercase">
          {col.cases.length} cases
        </p>
      </div>

      <GalleryClient
        cases={col.cases}
        categories={categories}
        years={years}
        regions={regions}
        defaultSort="award"
        awardContext={{ org: org as OrgKey, year: col.year, category: col.category }}
      />
    </div>
  );
}
