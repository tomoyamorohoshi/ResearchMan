import { cases, getCaseById } from "@/lib/cases";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import VideoPlayer from "@/components/VideoPlayer";
import { tagLabel } from "@/lib/tags";

export function generateStaticParams() {
  return cases.map((c) => ({ slug: c.id }));
}

export default async function CasePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const c = getCaseById(slug);
  if (!c) notFound();

  return (
    <div className="min-h-screen bg-[#eeece7]">
      {/* ヘッダー */}
      <header className="border-b border-gray-300 px-4 py-4 flex items-center gap-6">
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
      <div className="max-w-3xl mx-auto px-4 py-10">

        {c.videoId ? (
          <VideoPlayer videoId={c.videoId} title={c.title} />
        ) : (
          <div className="relative aspect-video rounded-xl overflow-hidden mb-8 bg-gray-100">
            <Image
              src={c.thumbnail}
              alt={c.title}
              fill
              className="object-cover"
              priority
            />
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-4">
          {c.categories.map((cat) => (
            <span
              key={cat}
              className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full font-medium"
            >
              {cat}
            </span>
          ))}
          {c.regions.map((r) => (
            <span
              key={r}
              className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full"
            >
              {r}
            </span>
          ))}
          {(c.sources ?? []).map((s) => (
            <span
              key={s}
              className="text-xs px-2 py-0.5 border border-gray-900 text-gray-900 rounded-full font-medium"
            >
              #{s}
            </span>
          ))}
          {(c.tags ?? []).map((t) => (
            <span
              key={t}
              className="text-xs px-2 py-0.5 bg-white border border-gray-300 text-gray-600 rounded-full"
              title={t}
            >
              #{tagLabel(t)}
            </span>
          ))}
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">{c.title}</h1>
        <p className="text-gray-600 mb-6">{c.summary}</p>

        <div className="grid grid-cols-2 gap-4 mb-8 p-4 bg-white rounded-xl border border-gray-100 text-sm">
          <div>
            <span className="text-gray-400 text-xs">クライアント</span>
            <p className="font-medium text-gray-800">{c.client}</p>
          </div>
          <div>
            <span className="text-gray-400 text-xs">エージェンシー</span>
            <p className="font-medium text-gray-800">{c.agency}</p>
          </div>
          <div>
            <span className="text-gray-400 text-xs">年</span>
            <p className="font-medium text-gray-800">{c.year}</p>
          </div>
          <div>
            <span className="text-gray-400 text-xs">受賞</span>
            <p className="font-medium text-gray-800">{c.award}</p>
          </div>
        </div>

        {c.link && (
          <a
            href={c.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm text-indigo-600 hover:text-indigo-800 mb-8 underline underline-offset-2"
          >
            一次ソースを見る →
          </a>
        )}

        <div className="space-y-10">
          <Section title="概要" content={c.overview} />
          <Section title="背景" content={c.background ?? c.mechanism ?? ""} />
          <Section title="企画・エグゼキューション" content={c.execution ?? c.mechanism ?? ""} />
          <Section title="評価ポイント・世の中的インパクト" content={c.evaluationImpact ?? `${c.evaluation ?? ""}\n\n${c.impact ?? ""}`.trim()} />
          {c.relatedWorks && (
            <RelatedWorksSection works={c.relatedWorks} />
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, content, accent }: { title: string; content: string; accent?: boolean }) {
  if (!content) return null;
  return (
    <div>
      <h2 className={`text-base font-bold mb-3 pb-2 border-b ${accent ? "text-indigo-700 border-indigo-100" : "text-gray-900 border-gray-100"}`}>
        {title}
      </h2>
      <p className="text-gray-700 text-sm leading-relaxed whitespace-pre-line">{content}</p>
    </div>
  );
}

type RelatedWork = { title: string; description: string; url: string };

function RelatedWorksSection({ works }: { works: RelatedWork[] | string }) {
  return (
    <div>
      <h2 className="text-base font-bold text-indigo-700 mb-3 pb-2 border-b border-indigo-100">
        関連事例
      </h2>
      {Array.isArray(works) ? (
        <div className="space-y-4">
          {works.map((w, i) => (
            <div key={i} className="pl-3 border-l-2 border-indigo-100">
              <a
                href={w.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
              >
                {w.title} →
              </a>
              <p className="text-gray-600 text-sm mt-0.5 leading-relaxed">{w.description}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-gray-700 text-sm leading-relaxed whitespace-pre-line">{works}</p>
      )}
    </div>
  );
}
