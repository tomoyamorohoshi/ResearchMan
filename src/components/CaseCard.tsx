import Link from "next/link";
import Image from "next/image";
import type { Case } from "@/lib/cases";

export default function CaseCard({ c }: { c: Case }) {
  return (
    <Link href={`/cases/${c.id}`} className="group block">
      <div className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 hover:shadow-lg hover:-translate-y-1 transition-all duration-200">
        <div className="relative aspect-video bg-gray-100 overflow-hidden">
          <Image
            src={c.thumbnail}
            alt={c.title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        </div>
        <div className="p-4">
          <div className="flex flex-wrap gap-1 mb-2">
            {c.categories.slice(0, 2).map((cat) => (
              <span
                key={cat}
                className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full font-medium"
              >
                {cat}
              </span>
            ))}
          </div>
          <h2 className="font-bold text-gray-900 text-sm leading-tight mb-1 line-clamp-2">
            {c.title}
          </h2>
          <p className="text-xs text-gray-500 line-clamp-2 mb-3">{c.summary}</p>
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>{c.agency}</span>
            <span>{c.year}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
