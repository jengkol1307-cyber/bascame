import { requireHiker } from "@/lib/dashboard/hiker";
import { HikerNavigation } from "../hiker-navigation";
import { ChecklistManager } from "./checklist-manager";

export const instant = false;

export default async function HikerChecklistPage() {
  const user = await requireHiker();
  return (
    <main className="dashboard-shell">
      <HikerNavigation activePath="/dashboard/checklist" username={user.username} />
      <section className="dashboard-main">
        <div className="dashboard-topline"><span>Dashboard pendaki / Checklist</span></div>
        <h1>Checklist persiapan</h1>
        <p className="dashboard-lede">Simpan dan periksa persiapan untuk setiap kebutuhan perjalananmu.</p>
        <ChecklistManager />
      </section>
    </main>
  );
}
