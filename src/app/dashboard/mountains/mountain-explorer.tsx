"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Mountain = {
  id: string;
  name: string;
  location: string;
  elevation: string;
  status: string;
  description: string;
};

export function MountainExplorer() {
  const [mountains, setMountains] = useState<Mountain[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadMountains() {
      try {
        const response = await fetch("/api/mountains", { credentials: "same-origin" });
        const result = (await response.json()) as { mountains?: Mountain[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Daftar gunung belum dapat dimuat.");
        setMountains(result.mountains ?? []);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Daftar gunung belum dapat dimuat.");
      } finally {
        setLoading(false);
      }
    }
    void loadMountains();
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return mountains;
    return mountains.filter((mountain) =>
      `${mountain.name} ${mountain.location} ${mountain.status}`.toLowerCase().includes(query),
    );
  }, [mountains, search]);

  return (
    <section className="hiker-page-stack">
      <div className="dashboard-panel">
        <span className="eyebrow">INFORMASI BASECAMP</span>
        <h2>Temukan jalur berikutnya</h2>
        <p>Informasi publik dari pengelola basecamp. Pastikan status jalur telah diperbarui sebelum menyusun perjalanan.</p>
        <label className="form-field mountain-search">Cari gunung atau lokasi<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Contoh: Rinjani, Lombok" /></label>
      </div>
      {error && <div className="auth-error" role="alert">{error}</div>}
      {loading ? <div className="dashboard-panel"><p>Memuat informasi gunung...</p></div> : filtered.length === 0 ? (
        <div className="dashboard-panel hiker-empty">
          <strong>{mountains.length ? "Tidak ada hasil yang cocok." : "Belum ada gunung yang dipublikasikan."}</strong>
          <span>Informasi akan tampil setelah pengelola menambahkan dan memublikasikan data basecamp.</span>
        </div>
      ) : (
        <div className="hiker-mountain-grid">
          {filtered.map((mountain, index) => (
            <article className="hiker-mountain-card" key={mountain.id}>
              <div className={`hiker-mountain-art hiker-mountain-art-${(index % 3) + 1}`} aria-hidden="true"><span className="card-peak" /><span className="card-hill" /></div>
              <div className="hiker-mountain-body">
                <span className="hiker-badge">{mountain.status}</span>
                <h3>{mountain.name}</h3>
                <p>{mountain.location || "Lokasi basecamp belum diatur"}{mountain.elevation ? ` · ${mountain.elevation}` : ""}</p>
                {mountain.description && <p>{mountain.description}</p>}
                <Link className="button button-primary" href={`/dashboard/trips?mountain=${encodeURIComponent(mountain.id)}`}>Rencanakan pendakian <span aria-hidden="true">→</span></Link>
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="hiker-disclaimer">Informasi jalur dan status operasional dikelola oleh basecamp. Ikuti arahan resmi petugas setempat.</p>
    </section>
  );
}
