import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { SignOutButton } from "../sign-out-button";

export const instant = false;

export default async function SuperadminDashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "superadmin") {
    redirect(user.role === "admin" ? "/dashboard/admin" : "/dashboard");
  }

  return (
    <main className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">B</span>
          <span>basecamp<span className="brand-period">.</span></span>
        </Link>
        <nav aria-label="Navigasi dashboard superadmin">
          <a href="/dashboard/superadmin" aria-current="page">Ringkasan</a>
          <a href="#platform">Platform</a>
          <Link href="/">Lihat halaman publik</Link>
        </nav>
        <div className="sidebar-note">Akses superadmin. Tetapkan admin basecamp dengan prinsip akses minimum.</div>
      </aside>
      <section className="dashboard-main">
        <div className="dashboard-topline">
          <span>Dashboard superadmin</span>
          <SignOutButton />
        </div>
        <h1>Selamat datang, {String(user.username ?? "superadmin")}</h1>
        <p className="dashboard-lede">
          Akun utama platform · {user.email ?? "dionyyr@gmail.com"}
        </p>
        <div className="dashboard-stats">
          <div className="stat-card"><small>Basecamp terdaftar</small><strong>—</strong></div>
          <div className="stat-card"><small>Admin aktif</small><strong>—</strong></div>
          <div className="stat-card"><small>Status platform</small><strong>Fondasi siap</strong></div>
        </div>
        <div className="dashboard-panel" id="platform">
          <h2>Pengelolaan platform</h2>
          <p>
            Akun ini memiliki custom claim <code>role: superadmin</code> dan
            profil di Firestore. Pengelolaan basecamp dan admin akan ditambahkan
            berikutnya.
          </p>
        </div>
      </section>
    </main>
  );
}
