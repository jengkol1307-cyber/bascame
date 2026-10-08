import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";
import { requireHiker } from "@/lib/dashboard/hiker";
import { HikerNavigation } from "../hiker-navigation";

export const instant = false;

type Announcement = {
  id: string;
  title: string;
  body: string;
  basecampName: string;
  category: string;
};

export default async function HikerNotificationsPage() {
  const user = await requireHiker();
  let announcements: Announcement[] = [];
  let errorMessage = "";
  try {
    const snapshot = await getFirebaseAdminFirestore()
      .collection("announcements")
      .where("visibility", "==", "public")
      .limit(50)
      .get();
    announcements = snapshot.docs.map((document) => {
      const data = document.data();
      return {
        id: document.id,
        title: typeof data.title === "string" ? data.title : "Informasi basecamp",
        body: typeof data.body === "string" ? data.body : "",
        basecampName: typeof data.basecampName === "string" ? data.basecampName : "Pengumuman resmi",
        category: typeof data.category === "string" ? data.category : "Informasi",
      };
    });
  } catch (error) {
    console.error("Could not load public announcements:", error);
    errorMessage = "Pengumuman belum dapat dimuat.";
  }

  return (
    <main className="dashboard-shell">
      <HikerNavigation activePath="/dashboard/notifications" username={user.username} />
      <section className="dashboard-main">
        <div className="dashboard-topline"><span>Dashboard pendaki / Informasi</span></div>
        <h1>Informasi & notifikasi</h1>
        <p className="dashboard-lede">Pengumuman publik dari pengelola basecamp dan informasi perjalanan.</p>
        {errorMessage && <div className="auth-error" role="alert">{errorMessage}</div>}
        {announcements.length === 0 && !errorMessage ? (
          <div className="dashboard-panel hiker-empty">
            <strong>Belum ada pengumuman publik.</strong>
            <span>Pengumuman dari pengelola yang tersedia akan tampil di sini.</span>
          </div>
        ) : (
          <div className="hiker-page-stack">
            {announcements.map((announcement) => (
              <article className="dashboard-panel hiker-announcement" key={announcement.id}>
                <span className="hiker-badge">{announcement.category}</span>
                <h2>{announcement.title}</h2>
                <p>{announcement.body}</p>
                <small>{announcement.basecampName}</small>
              </article>
            ))}
          </div>
        )}
        <div className="hiker-info-card dashboard-panel hiker-safety-note">
          <span className="hiker-info-icon" aria-hidden="true">!</span>
          <div><strong>Informasi keselamatan</strong><p>Pastikan status jalur dari pengelola resmi sebelum berangkat. Jika kondisi berubah, utamakan arahan petugas di lapangan.</p></div>
        </div>
      </section>
    </main>
  );
}
