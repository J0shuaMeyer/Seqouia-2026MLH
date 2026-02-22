"use client";

import Sidebar from "@/components/Sidebar";
import GlobeViewLoader from "@/components/GlobeViewLoader";
import SplashOverlay from "@/components/SplashOverlay";
import { GlobeDataProvider } from "@/context/GlobeDataContext";

export default function Home() {
  return (
    <GlobeDataProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-black">
        <SplashOverlay />
        <Sidebar />
        <main className="ml-64 flex-1">
          <GlobeViewLoader />
        </main>
      </div>
    </GlobeDataProvider>
  );
}
