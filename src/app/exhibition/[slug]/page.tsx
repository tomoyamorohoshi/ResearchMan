import { exhibitionItems, getExhibitionBySlug, todayJst } from "@/lib/exhibition";
import ExhibitionBadge, { formatPeriod } from "@/components/ExhibitionBadge";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";

// 終了済みも含めて全 items を静的生成する（一覧には出ないが URL では 200 で開け「終了」表示）
export function generateStaticParams() {
  return exhibitionItems.map((e) => ({ slug: e.slug }));
}

export const dynamicParams = false;

const SOURCE_KIND_LABEL = { official: "公式", listing: "掲載", social: "SNS", news: "報道" } as const;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const e = getExhibitionBySlug(slug);
  if (!e) return { title: "Not Found — ResearchMan" };
  const title = `${e.title} — ResearchMan Exhibition`;
  const description = `${e.venue}（${e.prefecture}） ${formatPeriod(e.startDate, e.endDate)}`;
  return {
    title,
    description,
    openGraph: { title, description, images: [e.thumbnail], type: "article" },
    twitter: { card: "summary_large_image", title, description, images: [e.thumbnail] },
  };
}

export default async function ExhibitionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const e = getExhibitionBySlug(slug);
  if (!e) notFound();

  const today = todayJst();

  return (
    <div className="min-h-screen bg-[#eeece7]">
      <header className="border-b border-gray-300 px-4 py-4 flex items-center gap-6">
        <Link href="/exhibition" className="text-xl font-black tracking-tight text-gray-900 leading-none">
          ResearchMan
        </Link>
        <Link
          href="/exhibition"
          className="text-[9px] tracking-[0.25em] uppercase text-gray-400 hover:text-gray-900 transition-colors"
        >
          ← Exhibition
        </Link>
      </header>
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="relative aspect-video rounded-xl overflow-hidden mb-8 bg-gray-100">
          <Image src={e.thumbnail} alt={e.title} fill className="object-cover" priority />
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <ExhibitionBadge e={e} today={today} size="md" />
          {e.tags.map((t) => (
            <span key={t} className="text-xs px-2 py-0.5 bg-white border border-gray-300 text-gray-600 rounded-full">
              #{t}
            </span>
          ))}
        </div>

        <h1 className="text-3xl font-black tracking-tight text-gray-900 mb-2">{e.title}</h1>
        {e.artists.length > 0 && <p className="text-sm text-gray-600 mb-6">{e.artists.join(" / ")}</p>}

        <dl className="grid grid-cols-[5rem_1fr] gap-x-4 gap-y-2 text-sm text-gray-800 mb-8">
          <dt className="text-[10px] tracking-[0.2em] uppercase text-gray-400 font-bold pt-0.5">会期</dt>
          <dd className="tabular-nums">{formatPeriod(e.startDate, e.endDate)}</dd>
          <dt className="text-[10px] tracking-[0.2em] uppercase text-gray-400 font-bold pt-0.5">会場</dt>
          <dd>
            {e.venue}
            <span className="text-gray-500">
              （{e.prefecture}
              {e.city ? ` ${e.city}` : ""}）
            </span>
          </dd>
          <dt className="text-[10px] tracking-[0.2em] uppercase text-gray-400 font-bold pt-0.5">入場料</dt>
          <dd>{e.admission === "UNKNOWN" ? "不明（公式サイトで確認）" : e.admission}</dd>
        </dl>

        <a
          href={e.link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-[11px] tracking-[0.2em] uppercase font-black px-4 py-2 bg-gray-900 text-white hover:bg-gray-700 transition-colors mb-8"
        >
          公式ページを開く ↗
        </a>

        <section className="mb-8">
          <h2 className="text-[10px] tracking-[0.3em] uppercase text-gray-400 font-bold mb-2">Why it matches</h2>
          <p className="text-sm text-gray-800 leading-relaxed">{e.matchReason}</p>
        </section>

        <section className="mb-8">
          <h2 className="text-[10px] tracking-[0.3em] uppercase text-gray-400 font-bold mb-2">Sources</h2>
          <ul className="space-y-1.5">
            {e.sources.map((s) => (
              <li key={s.url} className="flex items-center gap-2 min-w-0">
                <span className="text-[9px] tracking-widest uppercase font-bold text-gray-500 border border-gray-300 px-1.5 py-0.5 shrink-0 w-14 text-center">
                  {SOURCE_KIND_LABEL[s.kind]}
                </span>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-indigo-700 hover:underline truncate"
                >
                  {s.name || s.url}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
