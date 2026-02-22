"use client";

import Sidebar from "@/components/Sidebar";
import GlobeViewLoader from "@/components/GlobeViewLoader";
import { GlobeDataProvider } from "@/context/GlobeDataContext";

export default function Home() {
  return (
    <GlobeDataProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-black">
        <Sidebar />
        <main className="ml-64 flex-1">
          <GlobeViewLoader />
        </main>
      </div>
    </GlobeDataProvider>
  );
}
