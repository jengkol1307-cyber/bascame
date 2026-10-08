import Link from "next/link";
import { SignOutButton } from "./sign-out-button";

const links = [
  { href: "/dashboard", label: "Ringkasan", icon: "⌂" },
  { href: "/dashboard/mountains", label: "Jelajahi gunung", icon: "⌁" },
  { href: "/dashboard/trips", label: "Pendakian saya", icon: "↟" },
  { href: "/dashboard/documents", label: "Dokumen", icon: "▤" },
  { href: "/dashboard/checklist", label: "Checklist", icon: "☑" },
  { href: "/dashboard/notifications", label: "Notifikasi", icon: "◉" },
  { href: "/dashboard/profile", label: "Profil & keamanan", icon: "○" },
];

export function HikerNavigation({
  activePath,
  username,
}: {
  activePath: string;
  username?: string;
}) {
  return (
    <aside className="dashboard-sidebar">
      <Link className="brand" href="/">
        <span className="brand-mark" aria-hidden="true">B</span>
        <span>basecamp<span className="brand-period">.</span></span>
      </Link>
      <div className="hiker-account">
        <span className="hiker-avatar" aria-hidden="true">
          {(username?.[0] ?? "P").toUpperCase()}
        </span>
        <span><strong>{username ?? "Pendaki"}</strong><small>Akun pendaki</small></span>
      </div>
      <nav aria-label="Navigasi dashboard pendaki">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={activePath === link.href ? "page" : undefined}
          >
            <span aria-hidden="true">{link.icon}</span>{link.label}
          </Link>
        ))}
      </nav>
      <div className="sidebar-note">Siapkan diri, pantau informasi resmi, dan jaga alam selama perjalanan.</div>
      <SignOutButton />
    </aside>
  );
}
