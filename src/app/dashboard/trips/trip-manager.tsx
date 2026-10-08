"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";

type Mountain = {
  id: string;
  name: string;
  location: string;
  elevation: string;
  status: string;
  quota: number | null;
};

type Registration = {
  id: string;
  mountainId: string;
  mountainName: string;
  startDate: string;
  endDate: string;
  groupSize: number;
  status: string;
  ticketCode?: string | null;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  notes?: string;
  decisionNote?: string;
};

type EditingRegistration = Pick<
  Registration,
  | "id"
  | "mountainId"
  | "startDate"
  | "endDate"
  | "groupSize"
  | "emergencyContactName"
  | "emergencyContactPhone"
  | "notes"
>;

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
    case "needs_revision":
    case "revision_requested": return "Perlu revisi";
    case "rejected": return "Ditolak";
    case "checked_in": return "Sudah check-in";
    case "checked_out": return "Selesai";
    case "cancelled": return "Dibatalkan";
    default: return "Menunggu verifikasi";
  }
}

function canEditRegistration(status: string) {
  return ["pending", "revision_requested", "needs_revision"].includes(status);
}

function isMountainOpen(status: string) {
  return ["buka", "dibuka", "open"].includes(status.trim().toLocaleLowerCase("id-ID"));
}

export function TripManager({ initialMountainId = "" }: Props) {
  const [mountains, setMountains] = useState<Mountain[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<EditingRegistration | null>(null);
  const [mutatingId, setMutatingId] = useState("");
  const openMountains = mountains.filter((mountain) => isMountainOpen(mountain.status));

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

  function beginEditing(trip: Registration) {
    setError("");
    setNotice("");
    setEditing({
      id: trip.id,
      mountainId: trip.mountainId,
      startDate: trip.startDate,
      endDate: trip.endDate,
      groupSize: trip.groupSize,
      emergencyContactName: trip.emergencyContactName ?? "",
      emergencyContactPhone: trip.emergencyContactPhone ?? "",
      notes: trip.notes ?? "",
    });
  }

  async function saveEdits(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setError("");
    setNotice("");
    setMutatingId(editing.id);
    try {
      const response = await fetch(`/api/registrations/${encodeURIComponent(editing.id)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mountainId: editing.mountainId,
          startDate: editing.startDate,
          endDate: editing.endDate,
          groupSize: editing.groupSize,
          emergencyContactName: editing.emergencyContactName,
          emergencyContactPhone: editing.emergencyContactPhone,
          notes: editing.notes,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Pengajuan belum dapat diperbarui.");
      setEditing(null);
      setNotice("Pengajuan diperbarui dan dikirim kembali untuk verifikasi.");
      await loadData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pengajuan belum dapat diperbarui.");
    } finally {
      setMutatingId("");
    }
  }

  async function cancelRegistration(trip: Registration) {
    if (!window.confirm(`Batalkan pengajuan pendakian ke ${trip.mountainName}?`)) return;
    setError("");
    setNotice("");
    setMutatingId(trip.id);
    try {
      const response = await fetch(`/api/registrations/${encodeURIComponent(trip.id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Pengajuan belum dapat dibatalkan.");
      if (editing?.id === trip.id) setEditing(null);
      setNotice("Pengajuan berhasil dibatalkan.");
      await loadData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pengajuan belum dapat dibatalkan.");
    } finally {
      setMutatingId("");
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
        {!loading && openMountains.length === 0 ? (
          <div className="hiker-empty">
            <strong>{mountains.length === 0 ? "Belum ada gunung yang dipublikasikan." : "Semua jalur sedang ditutup untuk pendaftaran."}</strong>
            <span>{mountains.length === 0 ? "Pengelola dapat menambahkan informasi publik di dashboard admin." : "Cek kembali informasi gunung atau pengumuman dari pengelola sebelum mencoba lagi."}</span>
          </div>
        ) : (
          <form className="hiker-form" onSubmit={submitRegistration}>
            <label className="form-field">
              Gunung dan basecamp
              <select name="mountainId" defaultValue={initialMountainId} required disabled={loading || !mountains.length}>
                <option value="">Pilih gunung</option>
                {mountains.map((mountain) => (
                  <option key={mountain.id} value={mountain.id} disabled={!isMountainOpen(mountain.status)}>
                    {mountain.name}{mountain.location ? ` — ${mountain.location}` : ""} · {mountain.status}
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
            <button className="button button-primary" disabled={submitting || loading || !openMountains.length}>
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
              <article className="hiker-trip-card" key={trip.id}>
                <div className="hiker-list-row">
                  <span className="hiker-list-icon" aria-hidden="true">↟</span>
                  <div className="hiker-list-content">
                    <strong>{trip.mountainName}</strong>
                    <span>{trip.startDate} – {trip.endDate} · {trip.groupSize} anggota</span>
                    {trip.ticketCode && <span>Kode tiket: {trip.ticketCode}</span>}
                    {trip.decisionNote && <span className="hiker-revision-note">Catatan pengelola: {trip.decisionNote}</span>}
                  </div>
                  <span className={`hiker-badge hiker-badge-${trip.status}`}>{statusLabel(trip.status)}</span>
                  {canEditRegistration(trip.status) && (
                    <div className="hiker-trip-actions">
                      <button
                        className="hiker-document-action"
                        type="button"
                        disabled={Boolean(mutatingId)}
                        onClick={() => editing?.id === trip.id ? setEditing(null) : beginEditing(trip)}
                      >
                        {editing?.id === trip.id ? "Tutup" : "Ubah"}
                      </button>
                      <button
                        className="hiker-document-action hiker-document-delete"
                        type="button"
                        disabled={Boolean(mutatingId)}
                        onClick={() => void cancelRegistration(trip)}
                      >
                        Batalkan
                      </button>
                    </div>
                  )}
                </div>
                {trip.ticketCode && ["approved", "checked_in"].includes(trip.status) && (
                  <div className="hiker-ticket-qr">
                    <QRCodeSVG value={trip.ticketCode} size={176} level="M" title={`QR tiket ${trip.mountainName}`} />
                    <div>
                      <strong>Tiket digital</strong>
                      <span>Tunjukkan QR ini kepada petugas saat check-in dan check-out.</span>
                      <small>{trip.ticketCode}</small>
                    </div>
                  </div>
                )}
                {editing?.id === trip.id && (
                  <form className="hiker-form hiker-edit-form" onSubmit={saveEdits}>
                    <label className="form-field">Gunung dan basecamp
                      <select
                        value={editing.mountainId}
                        onChange={(event) => setEditing({ ...editing, mountainId: event.target.value })}
                        required
                      >
                        {mountains.map((mountain) => (
                          <option
                            key={mountain.id}
                            value={mountain.id}
                            disabled={!isMountainOpen(mountain.status)}
                          >
                            {mountain.name} · {mountain.status}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="hiker-form-row">
                      <label className="form-field">Tanggal mulai<input type="date" min={localDate(0)} value={editing.startDate} onChange={(event) => setEditing({ ...editing, startDate: event.target.value })} required /></label>
                      <label className="form-field">Tanggal selesai<input type="date" min={localDate(0)} value={editing.endDate} onChange={(event) => setEditing({ ...editing, endDate: event.target.value })} required /></label>
                      <label className="form-field">Jumlah anggota<input type="number" min="1" max="20" value={editing.groupSize} onChange={(event) => setEditing({ ...editing, groupSize: Number(event.target.value) })} required /></label>
                    </div>
                    <div className="hiker-form-row">
                      <label className="form-field">Nama kontak darurat<input value={editing.emergencyContactName} onChange={(event) => setEditing({ ...editing, emergencyContactName: event.target.value })} minLength={2} maxLength={80} required /></label>
                      <label className="form-field">Telepon kontak darurat<input type="tel" value={editing.emergencyContactPhone} onChange={(event) => setEditing({ ...editing, emergencyContactPhone: event.target.value })} minLength={6} maxLength={32} required /></label>
                    </div>
                    <label className="form-field">Catatan untuk pengelola<textarea rows={3} maxLength={500} value={editing.notes} onChange={(event) => setEditing({ ...editing, notes: event.target.value })} /></label>
                    <div className="hiker-trip-actions">
                      <button className="button button-primary" disabled={Boolean(mutatingId)}>{mutatingId === trip.id ? "Menyimpan..." : "Simpan & kirim ulang"}</button>
                      <button className="button button-outline" type="button" disabled={Boolean(mutatingId)} onClick={() => setEditing(null)}>Batal</button>
                    </div>
                  </form>
                )}
              </article>
            ))}
          </div>
        )}
        <Link className="back-home" href="/dashboard/notifications">Lihat informasi dan pemberitahuan →</Link>
      </section>
    </div>
  );
}
