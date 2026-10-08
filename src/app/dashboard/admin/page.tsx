import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { SignOutButton } from "../sign-out-button";

export const instant = false;

export default async function AdminDashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "superadmin") redirect("/dashboard/superadmin");
  if (user.role !== "admin") redirect("/dashboard");

  return (
    <main className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">B</span>
          <span>basecamp<span className="brand-period">.</span></span>
        </Link>
        <nav aria-label="Navigasi dashboard admin">
          <a href="/dashboard/admin" aria-current="page">Ringkasan</a>
          <a href="#pendakian">Pendaftaran</a>
          <a href="#pengumuman">Pengumuman</a>
          <Link href="/">Lihat halaman publik</Link>
        </nav>
        <div className="sidebar-note">Akun ini memiliki peran admin. Kelola hak akses melalui custom claims Firebase.</div>
      </aside>
      <section className="dashboard-main">
        <div className="dashboard-topline">
          <span>Dashboard pengelola</span>
          <SignOutButton />
        </div>
        <h1>Ringkasan operasional</h1>
        <p className="dashboard-lede">Masuk sebagai {user.email ?? "admin"}.</p>
        <div className="dashboard-stats">
          <div className="stat-card"><small>Pendaftaran hari ini</small><strong>—</strong></div>
          <div className="stat-card"><small>Kuota tersedia</small><strong>—</strong></div>
          <div className="stat-card"><small>Status jalur</small><strong>Belum diatur</strong></div>
        </div>
        <div className="dashboard-panel" id="pendakian">
          <h2>Basecamp belum dikonfigurasi</h2>
          <p>
            Fondasi dashboard sudah siap. Data jalur, kuota, dan pendaftaran
            akan ditampilkan setelah konfigurasi basecamp dan koleksi Firestore
            disiapkan.
          </p>
        </div>
        <div className="dashboard-panel" id="pengumuman" style={{ marginTop: 16 }}>
          <h2>Pengumuman</h2>
          <p>Pengelolaan pengumuman akan tersedia pada tahap berikutnya.</p>
        </div>
      </section>
    </main>
  );
}
