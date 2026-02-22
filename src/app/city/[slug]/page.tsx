import { notFound } from "next/navigation";
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
    </div>
  );
}
