import { useId, type ReactNode } from "react";

export function SidebarDrawer({
  children,
  label,
  className = "",
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  const drawerId = useId();

  return (
    <>
      <input
        id={drawerId}
        className="sidebar-drawer-state"
        type="checkbox"
        aria-label="Buka atau tutup navigasi"
      />
      <label
        className="sidebar-drawer-toggle"
        htmlFor={drawerId}
        aria-controls="dashboard-sidebar-drawer"
      >
        <span aria-hidden="true">☰</span>
      </label>
      <label
        className="sidebar-drawer-backdrop"
        htmlFor={drawerId}
        aria-label="Tutup navigasi"
      />
      <aside
        id="dashboard-sidebar-drawer"
        className={`dashboard-sidebar dashboard-sidebar-drawer${className ? ` ${className}` : ""}`}
        aria-label={label}
      >
        {children}
        <label className="sidebar-drawer-close" htmlFor={drawerId}>
          Tutup navigasi
        </label>
      </aside>
    </>
  );
}
