"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { SignOutButton } from "../sign-out-button";

export type DashboardMetric = {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: "green" | "amber" | "blue" | "violet" | "slate";
};

export type DashboardPanel = {
  id: string;
  label: string;
  detail: string;
  icon: string;
  content: ReactNode;
};

type AdminDashboardViewProps = {
  roleLabel: string;
  roleDescription: string;
  displayName: string;
  initials: string;
  basecampName: string;
  metrics: DashboardMetric[];
  summaryError: string;
  panels: DashboardPanel[];
  initialPanelId: string;
};

export function AdminDashboardView({
  roleLabel,
  roleDescription,
  displayName,
  initials,
  basecampName,
  metrics,
  summaryError,
  panels,
  initialPanelId,
}: AdminDashboardViewProps) {
  const activePanelId = initialPanelId;
  const activePanel = panels.find((panel) => panel.id === activePanelId);
  const firstName = displayName.split(/\s+/)[0];

  return (
    <main className="dashboard-shell admin-dashboard-shell">
      <details
        className="dashboard-sidebar admin-sidebar"
        role="complementary"
        aria-label="Navigasi dashboard admin"
      >
        <summary className="admin-sidebar-toggle">
          <span aria-hidden="true">☰</span>
          <span className="admin-sidebar-toggle-open">Sembunyikan menu</span>
          <span className="admin-sidebar-toggle-closed">Buka menu</span>
        </summary>
        <Link className="brand" href="/" aria-label="Basecamp, halaman utama">
          <span className="brand-mark" aria-hidden="true">B</span>
          <span>basecamp<span className="brand-period">.</span></span>
        </Link>
        <div className="admin-workspace-label">
          <span className="admin-workspace-dot" />
          <span>RUANG KERJA</span>
        </div>
        <nav className="admin-menu" aria-label="Menu operasional">
          <span className="admin-menu-caption">MENU UTAMA</span>
          <a
            className="admin-menu-link"
            href="/dashboard/admin"
            aria-current={activePanelId === "overview" ? "page" : undefined}
          >
            <span className="admin-menu-icon" aria-hidden="true">⌂</span>
            <span className="admin-menu-copy">
              <strong>Ringkasan</strong>
              <small>KPI dan ikhtisar operasional</small>
            </span>
            <span className="admin-menu-arrow" aria-hidden="true">›</span>
          </a>
          {panels.map((panel) => (
            <a
              className="admin-menu-link"
              href={`/dashboard/admin?panel=${encodeURIComponent(panel.id)}`}
              aria-current={activePanelId === panel.id ? "page" : undefined}
              key={panel.id}
            >
              <span className="admin-menu-icon" aria-hidden="true">{panel.icon}</span>
              <span className="admin-menu-copy">
                <strong>{panel.label}</strong>
                <small>{panel.detail}</small>
              </span>
              <span className="admin-menu-arrow" aria-hidden="true">›</span>
            </a>
          ))}
        </nav>
        <div className="admin-sidebar-bottom">
          <Link className="admin-public-link" href="/">
            <span aria-hidden="true">↗</span>
            Lihat halaman publik
          </Link>
          <div className="admin-account-card">
            <span className="admin-account-avatar">{initials}</span>
            <span className="admin-account-copy">
              <strong>{displayName}</strong>
              <small>{roleLabel}</small>
            </span>
          </div>
        </div>
      </details>

      <section className="dashboard-main admin-dashboard-main">
        <header className="admin-topbar">
          <div className="admin-breadcrumb">
            <span>{basecampName}</span>
            <span aria-hidden="true">/</span>
            <strong>{activePanel?.label ?? "Ringkasan"}</strong>
          </div>
          <div className="admin-topbar-actions">
            <span className="admin-role-badge">{roleLabel}</span>
            <SignOutButton />
          </div>
        </header>

        {activePanel ? (
          <div className="admin-section-view">
            <div className="admin-page-heading">
              <span className="admin-kicker">RUANG KERJA / {roleLabel.toUpperCase()}</span>
              <h1>{activePanel.label}</h1>
              <p>{activePanel.detail}</p>
            </div>
            {activePanel.content}
          </div>
        ) : (
          <div className="admin-content-stack">
            <section className="admin-welcome">
              <div className="admin-welcome-copy">
                <span className="admin-kicker">DASHBOARD PENGELOLA</span>
                <h1>Selamat datang, {firstName}</h1>
                <p>{roleDescription}</p>
                <div className="admin-welcome-meta">
                  <span><i /> Akses aktif</span>
                  <span>{basecampName}</span>
                </div>
              </div>
              <div className="admin-welcome-mark" aria-hidden="true">
                <span className="admin-mark-ring admin-mark-ring-one" />
                <span className="admin-mark-ring admin-mark-ring-two" />
                <span className="admin-mark-letter">B</span>
              </div>
            </section>

            <section className="admin-kpi-section" aria-labelledby="admin-kpi-title">
              <div className="admin-section-heading">
                <div>
                  <span className="admin-kicker">GAMBARAN HARI INI</span>
                  <h2 id="admin-kpi-title">Ringkasan operasional</h2>
                </div>
                <span className="admin-section-count">{basecampName}</span>
              </div>
              {summaryError ? (
                <div className="admin-summary-error" role="alert">
                  <strong>Data ringkasan belum tersedia</strong>
                  <span>{summaryError}</span>
                </div>
              ) : metrics.length > 0 ? (
                <div className="admin-kpi-grid">
                  {metrics.map((metric) => (
                    <article className={`admin-kpi-card admin-kpi-${metric.tone}`} key={metric.id}>
                      <span className="admin-kpi-label">{metric.label}</span>
                      <strong>{metric.value}</strong>
                      <small>{metric.detail}</small>
                      <span className="admin-kpi-mark" aria-hidden="true" />
                    </article>
                  ))}
                </div>
              ) : (
                <div className="admin-summary-empty">
                  Ringkasan pendaftaran tidak termasuk dalam hak akses role ini.
                </div>
              )}
            </section>

            <footer className="admin-footer">
              <span>Basecamp · Sistem operasional pengelola</span>
              <span>Hak akses mengikuti peran akun Anda</span>
            </footer>
          </div>
        )}
      </section>
    </main>
  );
}
