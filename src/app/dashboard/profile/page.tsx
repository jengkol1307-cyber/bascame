import { requireHiker } from "@/lib/dashboard/hiker";
import { HikerNavigation } from "../hiker-navigation";
import { ProfileForm } from "./profile-form";

export const instant = false;

export default async function HikerProfilePage() {
  const user = await requireHiker();
  return (
    <main className="dashboard-shell">
      <HikerNavigation activePath="/dashboard/profile" username={user.username} />
      <section className="dashboard-main">
        <div className="dashboard-topline"><span>Dashboard pendaki / Profil</span></div>
        <h1>Profil & keamanan</h1>
        <p className="dashboard-lede">Jaga informasi akun dan kontak darurat tetap akurat.</p>
        <ProfileForm />
      </section>
    </main>
  );
}
