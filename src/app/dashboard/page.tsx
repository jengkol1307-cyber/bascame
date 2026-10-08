import Link from "next/link";
import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";
import { requireHiker } from "@/lib/dashboard/hiker";
import { HikerNavigation } from "./hiker-navigation";

export const instant = false;

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Jakarta",
});

type TripSummary = {
  id: string;
  mountainName: string;
  startDate: string;
  endDate: string;
  status: string;
};

function greetingName(user: Awaited<ReturnType<typeof requireHiker>>) {
  return typeof user.name === "string" && user.name.trim()
    ? user.name
    : typeof user.username === "string" && user.username.trim()
      ? user.username
      : "Pendaki";
}

export default async function UserDashboardPage() {
  const user = await requireHiker();
  const firestore = getFirebaseAdminFirestore();
  let trips: TripSummary[] = [];
  let unreadAnnouncements = 0;
  let loadError = "";

  try {
    const [tripSnapshot, announcementSnapshot] = await Promise.all([
      firestore
        .collection("registrations")
        .where("ownerUid", "==", user.uid)
        .limit(20)
        .get(),
      firestore
        .collection("announcements")
        .where("visibility", "==", "public")
        .limit(50)
        .get(),
    ]);
    trips = tripSnapshot.docs
      .map((document) => {
        const data = document.data();
        return {
          id: document.id,
          mountainName: typeof data.mountainName === "string" ? data.mountainName : "Pendakian",
          startDate: typeof data.startDate === "string" ? data.startDate : "",
          endDate: typeof data.endDate === "string" ? data.endDate : "",
          status: typeof data.status === "string" ? data.status : "pending",
        };
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    unreadAnnouncements = announcementSnapshot.size;
  } catch (error) {
    console.error("Could not load hiker dashboard summary:", error);
    loadError = "Ringkasan belum dapat dimuat. Coba segarkan halaman.";
  }

  const nextTrip = trips.find((trip) =>
    ["pending", "approved", "needs_revision", "revision_requested", "checked_in"].includes(trip.status),
  );

  return (
    <main className="dashboard-shell">
      <HikerNavigation activePath="/dashboard" username={greetingName(user)} />
      <section className="dashboard-main">
        <div className="dashboard-topline">
          <span>{dateFormatter.format(new Date())}</span>
          <Link className="button button-small button-outline" href="/dashboard/trips">+ Rencanakan pendakian</Link>
        </div>
        <span className="eyebrow">RUANG PERSIAPAN PERJALANANMU</span>
        <h1>Halo, {greetingName(user)} <span aria-hidden="true">👋</span></h1>
        <p className="dashboard-lede">Satu tempat untuk merencanakan, menyiapkan, dan mengikuti perjalananmu.</p>

        {loadError && <div className="auth-error" role="alert">{loadError}</div>}

        <div className="hiker-hero-card">
          <div>
            <span className="eyebrow">PENDAKIAN BERIKUTNYA</span>
            {nextTrip ? (
              <>
                <h2>{nextTrip.mountainName}</h2>
                <p>{nextTrip.startDate} – {nextTrip.endDate}</p>
                <span className={`hiker-badge hiker-badge-${nextTrip.status}`}>
                  {nextTrip.status === "approved"
                    ? "Disetujui"
                    : ["needs_revision", "revision_requested"].includes(nextTrip.status)
                      ? "Perlu revisi"
                      : nextTrip.status === "checked_in"
                        ? "Sedang mendaki"
                        : "Menunggu verifikasi"}
                </span>
              </>
            ) : (
              <>
                <h2>Petualangan berikutnya dimulai di sini.</h2>
                <p>Temukan jalur yang cocok dan susun rencana pendakianmu.</p>
              </>
            )}
            <Link className="button button-light" href={nextTrip ? "/dashboard/trips" : "/dashboard/mountains"}>
              {nextTrip ? "Lihat detail perjalanan" : "Jelajahi gunung"} <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="hiker-hero-illustration" aria-hidden="true"><span /><i /><b /></div>
        </div>

        <div className="hiker-shortcuts">
          <Link href="/dashboard/trips"><span aria-hidden="true">↟</span><strong>Pendakian saya</strong><small>{trips.length} pengajuan</small></Link>
          <Link href="/dashboard/checklist"><span aria-hidden="true">☑</span><strong>Checklist</strong><small>Siapkan perlengkapan</small></Link>
          <Link href="/dashboard/documents"><span aria-hidden="true">▤</span><strong>Dokumen</strong><small>Kelola dokumenmu</small></Link>
          <Link href="/dashboard/notifications"><span aria-hidden="true">◉</span><strong>Informasi</strong><small>{unreadAnnouncements} pengumuman tersedia</small></Link>
        </div>

        <div className="hiker-panel-heading hiker-home-heading">
          <div><span className="eyebrow">TETAP SIAP & TERINFORMASI</span><h2>Informasi penting</h2></div>
          <Link href="/dashboard/notifications">Semua informasi →</Link>
        </div>
        <section className="dashboard-panel hiker-info-card">
          <span className="hiker-info-icon" aria-hidden="true">!</span>
          <div>
            <strong>Sebelum berangkat, cek kembali informasi dari pengelola jalur.</strong>
            <p>Status operasional, cuaca, dan persyaratan dapat berubah. Ikuti arahan resmi basecamp dan petugas setempat.</p>
            <Link href="/dashboard/mountains">Lihat informasi gunung →</Link>
          </div>
        </section>

        {trips.length > 0 && (
          <section className="dashboard-panel hiker-recent-trips">
            <div className="hiker-panel-heading"><h2>Aktivitas pendakian</h2><Link href="/dashboard/trips">Lihat semua →</Link></div>
            {trips.slice(0, 3).map((trip) => (
              <div className="hiker-list-row" key={trip.id}>
                <span className="hiker-list-icon" aria-hidden="true">↟</span>
                <div className="hiker-list-content"><strong>{trip.mountainName}</strong><span>{trip.startDate} – {trip.endDate}</span></div>
                <span className={`hiker-badge hiker-badge-${trip.status}`}>
                  {trip.status === "approved"
                    ? "Disetujui"
                    : trip.status === "rejected"
                      ? "Ditolak"
                      : ["needs_revision", "revision_requested"].includes(trip.status)
                        ? "Perlu revisi"
                        : trip.status === "checked_in"
                          ? "Sedang mendaki"
                          : trip.status === "checked_out"
                            ? "Selesai"
                            : trip.status === "cancelled"
                              ? "Dibatalkan"
                              : "Menunggu"}
                </span>
              </div>
            ))}
          </section>
        )}
      </section>
    </main>
  );
}
