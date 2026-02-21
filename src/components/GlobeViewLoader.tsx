"use client";

import dynamic from "next/dynamic";

const GlobeView = dynamic(() => import("@/components/GlobeView"), {
  ssr: false,
});

export default function GlobeViewLoader() {
  return <GlobeView />;
}
