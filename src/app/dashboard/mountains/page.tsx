import { requireHiker } from "@/lib/dashboard/hiker";
import { HikerNavigation } from "../hiker-navigation";
import { MountainExplorer } from "./mountain-explorer";

export const instant = false;

export default async function HikerMountainsPage() {
  const user = await requireHiker();
  return (
    <main className="dashboard-shell">
      <HikerNavigation activePath="/dashboard/mountains" username={user.username} />
      <section className="dashboard-main">
        <div className="dashboard-topline"><span>Dashboard pendaki / Jelajahi</span></div>
        <h1>Jelajahi gunung</h1>
        <p className="dashboard-lede">Cari jalur dan informasi basecamp yang sudah dipublikasikan pengelola.</p>
        <MountainExplorer />
      </section>
    </main>
  );
}
