import { notFound } from "next/navigation";
import Link from "next/link";
import { cities, getCityBySlug } from "@/data/cities";
import CityMapLoader from "@/components/CityMapLoader";

export function generateStaticParams() {
  return cities.map((c) => ({ slug: c.slug }));
}

export default async function CityPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const city = getCityBySlug(slug);

  if (!city) notFound();

  return (
    <div className="relative h-screen w-screen bg-black">
      <CityMapLoader city={city} />

      <Link
        href="/"
        className="absolute top-4 right-4 z-50 flex items-center gap-2 px-4 py-2 bg-black/70 backdrop-blur-sm border border-white/20 rounded-full text-sm text-white hover:bg-white/10 transition-colors"
      >
        &larr; Back to Globe
      </Link>
    </div>
  );
}
