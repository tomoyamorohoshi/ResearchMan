import { cases, getCaseById } from "@/lib/cases";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";

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
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-900 mb-8 transition-colors"
        >
          ← 一覧に戻る
        </Link>

        <div className="relative aspect-video rounded-xl overflow-hidden mb-8 bg-gray-100">
          <Image
            src={c.thumbnail}
            alt={c.title}
            fill
            className="object-cover"
            priority
          />
        </div>

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

        <div className="space-y-8">
          <Section title="概要" content={c.overview} />
          <Section title="仕組み" content={c.mechanism} />
          <Section title="インパクト" content={c.impact} />
          <Section title="評価ポイント" content={c.evaluation} />
        </div>
      </div>
    </div>
  );
}

function Section({ title, content }: { title: string; content: string }) {
  return (
    <div>
      <h2 className="text-base font-bold text-gray-900 mb-2 pb-2 border-b border-gray-100">
        {title}
      </h2>
      <p className="text-gray-700 text-sm leading-relaxed">{content}</p>
    </div>
  );
}
