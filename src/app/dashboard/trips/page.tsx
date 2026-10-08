import { requireHiker } from "@/lib/dashboard/hiker";
import { HikerNavigation } from "../hiker-navigation";
import { TripManager } from "./trip-manager";

export const instant = false;

export default async function HikerTripsPage({
  searchParams,
}: PageProps<"/dashboard/trips">) {
  const [user, params] = await Promise.all([requireHiker(), searchParams]);
  const initialMountainId = Array.isArray(params.mountain)
    ? params.mountain[0]
    : params.mountain;
  return (
    <main className="dashboard-shell">
      <HikerNavigation activePath="/dashboard/trips" username={user.username} />
      <section className="dashboard-main">
        <div className="dashboard-topline"><span>Dashboard pendaki / Perjalanan</span></div>
        <h1>Pendakian saya</h1>
        <p className="dashboard-lede">Ajukan perjalanan, pantau status verifikasi, dan lihat riwayat pendakian.</p>
        <TripManager initialMountainId={initialMountainId} />
      </section>
    </main>
  );
}
