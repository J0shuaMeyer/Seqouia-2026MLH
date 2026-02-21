import Sidebar from "@/components/Sidebar";
import GlobeViewLoader from "@/components/GlobeViewLoader";

export default function Home() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-black">
      <Sidebar />
      <main className="ml-64 flex-1">
        <GlobeViewLoader />
      </main>
    </div>
  );
}
