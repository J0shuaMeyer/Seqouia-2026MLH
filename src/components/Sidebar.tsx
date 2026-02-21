import Link from "next/link";
import { cities } from "@/data/cities";

export default function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 bottom-0 w-64 z-50 bg-black/80 backdrop-blur-md border-r border-white/10 flex flex-col">
      <div className="p-5 border-b border-white/10">
        <h1 className="text-xl font-bold tracking-[0.3em] text-white">
          SEQUOIA
        </h1>
        <p className="text-xs text-white/50 mt-1">Urban Activity Monitor</p>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {cities.map((city) => (
          <Link
            key={city.slug}
            href={`/city/${city.slug}`}
            className="flex items-center gap-3 px-5 py-2.5 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0" />
            <span className="truncate">{city.name}</span>
            <span className="ml-auto text-[10px] text-white/30">
              {city.country}
            </span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
