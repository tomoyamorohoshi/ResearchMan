import Link from "next/link";

// TOP直下の大分類タブ（Case Study / Technology / Exhibition / Visit / Ideas）。
// ページ間リンクにすることで各TOPのデータは分離されたまま（ペイロード肥大防止）。
export default function TopTabs({ active }: { active: "cases" | "tech" | "exhibition" | "visit" | "ideas" }) {
  const tabs = [
    { key: "cases", href: "/", label: "Case Study" },
    { key: "tech", href: "/technology", label: "Technology" },
    { key: "exhibition", href: "/exhibition", label: "Exhibition" },
    { key: "visit", href: "/visit", label: "Visit" },
    { key: "ideas", href: "/ideas", label: "Ideas" },
  ] as const;
  return (
    <nav
      aria-label="アーカイブ切替"
      className="max-w-[1600px] mx-auto px-4 flex items-stretch gap-0.5 sm:gap-1 overflow-x-auto overflow-y-hidden"
    >
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={`shrink-0 px-2 sm:px-3 py-2.5 text-[11px] tracking-[0.1em] sm:tracking-[0.2em] uppercase font-black transition-colors border-b-2 ${
            active === t.key
              ? "text-gray-900 border-gray-900"
              : "text-gray-400 border-transparent hover:text-gray-700"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
