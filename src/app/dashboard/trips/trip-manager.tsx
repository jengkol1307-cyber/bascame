"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

type Mountain = {
  id: string;
  name: string;
  location: string;
  elevation: string;
  status: string;
};

type Registration = {
  id: string;
  mountainName: string;
  startDate: string;
  endDate: string;
  groupSize: number;
  status: string;
  ticketCode?: string | null;
};

type Props = {
  initialMountainId?: string;
};

function localDate(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function statusLabel(status: string) {
  switch (status) {
    case "approved": return "Disetujui";
    case "needs_revision": return "Perlu perbaikan";
    case "rejected": return "Ditolak";
    case "checked_in": return "Sudah check-in";
    case "checked_out": return "Selesai";
    default: return "Menunggu verifikasi";
  }
}

export function TripManager({ initialMountainId = "" }: Props) {
  const [mountains, setMountains] = useState<Mountain[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadData() {
    try {
      const [mountainResponse, registrationResponse] = await Promise.all([
        fetch("/api/mountains", { credentials: "same-origin" }),
        fetch("/api/registrations", { credentials: "same-origin" }),
      ]);
      const mountainResult = (await mountainResponse.json()) as {
        mountains?: Mountain[];
        error?: string;
      };
      const registrationResult = (await registrationResponse.json()) as {
        registrations?: Registration[];
        error?: string;
      };
      if (!mountainResponse.ok) throw new Error(mountainResult.error ?? "Gunung belum dapat dimuat.");
      if (!registrationResponse.ok) throw new Error(registrationResult.error ?? "Pendakian belum dapat dimuat.");
      setMountains(mountainResult.mountains ?? []);
      setRegistrations(registrationResult.registrations ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Data belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void loadData(); }, 0);
    return () => window.clearTimeout(initialLoad);
  }, []);

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    setNotice("");
    setSubmitting(true);
    const values = new FormData(event.currentTarget);
    const payload = {
      mountainId: String(values.get("mountainId") ?? ""),
      startDate: String(values.get("startDate") ?? ""),
      endDate: String(values.get("endDate") ?? ""),
      groupSize: Number(values.get("groupSize")),
      emergencyContactName: String(values.get("emergencyContactName") ?? ""),
      emergencyContactPhone: String(values.get("emergencyContactPhone") ?? ""),
      notes: String(values.get("notes") ?? ""),
    };

    try {
      const response = await fetch("/api/registrations", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Pendaftaran gagal.");
      setNotice("Pengajuan pendakian berhasil dikirim. Menunggu verifikasi pengelola.");
      form.reset();
      await loadData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pendaftaran gagal.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="hiker-page-stack">
      <section className="dashboard-panel">
        <span className="eyebrow">RENCANAKAN PERJALANAN</span>
        <h2>Ajukan pendakian</h2>
        <p>Lengkapi rencana perjalanan dan kontak darurat. Pengajuan akan diverifikasi pengelola basecamp.</p>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {notice && <div className="hiker-success" role="status">{notice}</div>}
        {!loading && mountains.length === 0 ? (
          <div className="hiker-empty">
            <strong>Belum ada gunung yang dibuka untuk pendaftaran.</strong>
            <span>Pengelola dapat menambahkan informasi publik di dashboard admin.</span>
          </div>
        ) : (
          <form className="hiker-form" onSubmit={submitRegistration}>
            <label className="form-field">
              Gunung dan basecamp
              <select name="mountainId" defaultValue={initialMountainId} required disabled={loading || !mountains.length}>
                <option value="">Pilih gunung</option>
                {mountains.map((mountain) => (
                  <option key={mountain.id} value={mountain.id}>
                    {mountain.name}{mountain.location ? ` — ${mountain.location}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="hiker-form-row">
              <label className="form-field">Tanggal mulai<input type="date" name="startDate" min={localDate(0)} required /></label>
              <label className="form-field">Tanggal selesai<input type="date" name="endDate" min={localDate(0)} required /></label>
              <label className="form-field">Jumlah anggota<input type="number" name="groupSize" min="1" max="20" defaultValue="1" required /></label>
            </div>
            <div className="hiker-form-row">
              <label className="form-field">Nama kontak darurat<input type="text" name="emergencyContactName" minLength={2} maxLength={80} required /></label>
              <label className="form-field">Telepon kontak darurat<input type="tel" name="emergencyContactPhone" minLength={6} maxLength={32} required /></label>
            </div>
            <label className="form-field">Catatan untuk pengelola <span>(opsional)</span><textarea name="notes" maxLength={500} rows={3} /></label>
            <button className="button button-primary" disabled={submitting || loading || !mountains.length}>
              {submitting ? "Mengirim pengajuan..." : "Kirim pengajuan"}
            </button>
          </form>
        )}
      </section>

      <section className="dashboard-panel">
        <div className="hiker-panel-heading">
          <div><span className="eyebrow">RIWAYAT & STATUS</span><h2>Pendakian saya</h2></div>
          <span className="hiker-count">{registrations.length} pengajuan</span>
        </div>
        {loading ? <p>Memuat pendakian...</p> : registrations.length === 0 ? (
          <div className="hiker-empty">
            <strong>Belum ada pendakian terdaftar.</strong>
            <span>Gunakan formulir di atas untuk mengirim pengajuan pertama.</span>
          </div>
        ) : (
          <div className="hiker-list">
            {registrations.map((trip) => (
              <article className="hiker-list-row" key={trip.id}>
                <span className="hiker-list-icon" aria-hidden="true">↟</span>
                <div className="hiker-list-content">
                  <strong>{trip.mountainName}</strong>
                  <span>{trip.startDate} – {trip.endDate} · {trip.groupSize} anggota</span>
                  {trip.ticketCode && <span>Kode tiket: {trip.ticketCode}</span>}
                </div>
                <span className={`hiker-badge hiker-badge-${trip.status}`}>{statusLabel(trip.status)}</span>
              </article>
            ))}
          </div>
        )}
        <Link className="back-home" href="/dashboard/notifications">Lihat informasi dan pemberitahuan →</Link>
      </section>
    </div>
  );
}
