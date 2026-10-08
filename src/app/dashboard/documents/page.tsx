import { requireHiker } from "@/lib/dashboard/hiker";
import { HikerNavigation } from "../hiker-navigation";
import { DocumentLibrary } from "./document-library";

export const instant = false;

export default async function HikerDocumentsPage() {
  const user = await requireHiker();
  return (
    <main className="dashboard-shell">
      <HikerNavigation activePath="/dashboard/documents" username={user.username} />
      <section className="dashboard-main">
        <div className="dashboard-topline"><span>Dashboard pendaki / Dokumen</span></div>
        <h1>Dokumen pendakian</h1>
        <p className="dashboard-lede">Simpan dokumen penting untuk persiapan perjalananmu dengan akses privat.</p>
        <DocumentLibrary />
      </section>
    </main>
  );
}
