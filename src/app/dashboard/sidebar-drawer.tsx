"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

export function SidebarDrawer({
  children,
  label,
  className = "",
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        toggleRef.current?.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  function closeAfterSelection(event: MouseEvent<HTMLElement>) {
    const target = event.target;
    if (target instanceof Element && target.closest("a, nav button")) {
      setIsOpen(false);
    }
  }

  return (
    <>
      <button
        ref={toggleRef}
        className={`sidebar-drawer-toggle${isOpen ? " is-open" : ""}`}
        type="button"
        aria-label={isOpen ? "Tutup navigasi" : "Buka navigasi"}
        aria-expanded={isOpen}
        aria-controls="dashboard-sidebar-drawer"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span aria-hidden="true">{isOpen ? "×" : "☰"}</span>
      </button>
      {isOpen && (
        <button
          className="sidebar-drawer-backdrop"
          type="button"
          aria-label="Tutup navigasi"
          onClick={() => setIsOpen(false)}
        />
      )}
      <aside
        id="dashboard-sidebar-drawer"
        className={`dashboard-sidebar dashboard-sidebar-drawer${className ? ` ${className}` : ""}${isOpen ? " is-open" : ""}`}
        aria-label={label}
        aria-hidden={!isOpen}
        inert={!isOpen}
        onClick={closeAfterSelection}
      >
        {children}
      </aside>
    </>
  );
}
