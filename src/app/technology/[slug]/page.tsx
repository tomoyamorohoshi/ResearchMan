import { techItems, getTechById, COMMERCIAL_BADGE, TYPE_BADGE, LINK_KIND_LABEL } from "@/lib/tech";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";

export function generateStaticParams() {
  return techItems.map((t) => ({ slug: t.id }));
}

export default async function TechPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = getTechById(slug);
  if (!t) notFound();

  const typeBadge = TYPE_BADGE[t.type];
  const commercial = COMMERCIAL_BADGE[t.license.commercial];

  return (
    <div className="min-h-screen bg-[#eeece7]">
      {/* ヘッダー */}
      <header className="border-b border-gray-300 px-4 py-4 flex items-center gap-6">
        <Link href="/technology" className="text-xl font-black tracking-tight text-gray-900 leading-none">
          ResearchMan
        </Link>
        <Link
          href="/technology"
          className="text-[9px] tracking-[0.25em] uppercase text-gray-400 hover:text-gray-900 transition-colors"
        >
          ← Technology
        </Link>
      </header>
      <div className="max-w-3xl mx-auto px-4 py-10">
        {/* サムネイル */}
        <div className="relative aspect-video rounded-xl overflow-hidden mb-8 bg-gray-100">
          <Image
            src={t.thumbnail}
            alt={t.title}
            fill
            className="object-cover"
            priority
          />
        </div>

        {/* バッジ群 */}
        <div className="flex flex-wrap gap-2 mb-4">
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-bold ${typeBadge.color} ${typeBadge.bg}`}
          >
            {t.type}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${commercial.color} ${commercial.bg}`}
            title={t.license.note ?? undefined}
          >
            {commercial.label}
            {t.license.spdx ? ` (${t.license.spdx})` : ""}
          </span>
          {t.domains.map((d) => (
            <span
              key={d}
              className="text-xs px-2 py-0.5 bg-white border border-gray-300 text-gray-600 rounded-full"
            >
              #{d}
            </span>
          ))}
        </div>

        {/* タイトル・開発元 */}
        <h1 className="text-3xl font-black tracking-tight text-gray-900 mb-2">
          {t.title}
        </h1>
        <p className="text-sm text-gray-500 mb-8">
          <span className="font-bold text-gray-700">{t.org}</span>
          <span className="mx-2 text-gray-300">/</span>
          <span className="tabular-nums">{t.date}</span>
        </p>

        {/* 概要 */}
        <section className="mb-8">
          <h2 className="text-[10px] tracking-[0.3em] uppercase text-gray-400 font-bold mb-2">
            Overview
          </h2>
          <p className="text-sm text-gray-800 leading-relaxed">{t.summary}</p>
        </section>

        {/* 技術のポイント */}
        <section className="mb-8">
          <h2 className="text-[10px] tracking-[0.3em] uppercase text-gray-400 font-bold mb-2">
            技術のポイント
          </h2>
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-line">
            {t.point}
          </p>
        </section>

        {/* 技術の詳細 */}
        {t.detail && (
          <section className="mb-8">
            <h2 className="text-[10px] tracking-[0.3em] uppercase text-gray-400 font-bold mb-2">
              技術の詳細
            </h2>
            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-line">
              {t.detail}
            </p>
          </section>
        )}

        {/* 商用利用の補足 */}
        {t.license.note && (
          <section className="mb-8">
            <h2 className="text-[10px] tracking-[0.3em] uppercase text-gray-400 font-bold mb-2">
              License
            </h2>
            <p className="text-sm text-gray-800 leading-relaxed">{t.license.note}</p>
          </section>
        )}

        {/* 情報ソースリンク */}
        <section className="mb-8">
          <h2 className="text-[10px] tracking-[0.3em] uppercase text-gray-400 font-bold mb-2">
            Sources
          </h2>
          <ul className="space-y-1.5">
            {t.links.map((l) => (
              <li key={l.url} className="flex items-center gap-2 min-w-0">
                <span className="text-[9px] tracking-widest uppercase font-bold text-gray-500 border border-gray-300 px-1.5 py-0.5 shrink-0 w-16 text-center">
                  {LINK_KIND_LABEL[l.kind]}
                </span>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-indigo-700 hover:underline truncate"
                >
                  {l.url}
                </a>
              </li>
            ))}
          </ul>
        </section>

        {/* 関連作品・研究 */}
        {t.relatedWorks.length > 0 && (
          <section className="mb-8">
            <h2 className="text-[10px] tracking-[0.3em] uppercase text-gray-400 font-bold mb-3">
              Related Works
            </h2>
            <ul className="space-y-3">
              {t.relatedWorks.map((w) => (
                <li key={w.url}>
                  <a
                    href={w.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-bold text-gray-900 hover:underline"
                  >
                    {w.title}
                  </a>
                  {w.description && (
                    <p className="text-xs text-gray-500 leading-relaxed mt-0.5">
                      {w.description}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
