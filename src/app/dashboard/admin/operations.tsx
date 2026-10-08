"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@/lib/auth/roles";
import { QrTicketScanner } from "./qr-ticket-scanner";

type RegistrationRecord = {
  id: string;
  ownerName?: string;
  ownerEmail?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  mountainName?: string;
  startDate?: string;
  endDate?: string;
  groupSize?: number;
  memberNames?: string[];
  status?: string;
  ticketCode?: string | null;
};

type LedgerRecord = {
  id: string;
  registrationId: string;
  type: "charge" | "payment" | "refund";
  amount: number;
  method: string;
  note?: string;
};

type InfoRecord = {
  id: string;
  type: "mountain" | "announcement";
  title: string;
  content: string;
  location?: string;
  elevation?: string;
  latitude?: number | null;
  longitude?: number | null;
  status?: string;
  quota?: number | null;
  visibility: "public" | "draft";
};

type MountainData = {
  id: string;
  name?: string;
  location?: string;
  elevation?: string;
  status?: string;
  quota?: number | null;
  description?: string;
  visibility?: "public" | "draft";
};

type AnnouncementData = {
  id: string;
  title?: string;
  body?: string;
  visibility?: "public" | "draft";
};

const ROLE_ALL = ["admin", "superadmin", "basecamp_admin"];

function canUse(role: UserRole, action: "registration" | "finance" | "information") {
  if (ROLE_ALL.includes(role)) return true;
  if (action === "registration") {
    return role === "registration_operator" || role === "field_officer";
  }
  if (action === "finance") return role === "treasurer";
  return role === "information_manager";
}

function RegistrationWorkspace({ role }: { role: UserRole }) {
  const router = useRouter();
  const [registrations, setRegistrations] = useState<RegistrationRecord[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const fieldOnly = role === "field_officer";

  function reload() {
    setIsLoading(true);
    fetch("/api/registrations", { cache: "no-store" })
      .then(async (response) => {
        const result = (await response.json()) as {
          registrations?: RegistrationRecord[];
          error?: string;
        };
        if (!response.ok) throw new Error(result.error ?? "Pendaftaran gagal dimuat.");
        return result;
      })
      .then((result) => {
        setRegistrations(result.registrations ?? []);
        setErrorMessage("");
      })
      .catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : "Pendaftaran gagal dimuat.");
      })
      .finally(() => setIsLoading(false));
  }

  async function scanTicket(ticketCode: string, action: "check_in" | "check_out") {
    const response = await fetch("/api/registrations/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketCode, action }),
    });
    const result = (await response.json()) as {
      error?: string;
      action?: "check_in" | "check_out";
      mountainName?: string;
      startDate?: string;
      endDate?: string;
      groupSize?: number | null;
      memberNames?: string[];
    };
    if (!response.ok) throw new Error(result.error ?? "Tiket belum dapat diproses.");
    reload();
    router.refresh();
    const actionLabel = result.action === "check_in" ? "Check-in berhasil" : "Check-out berhasil";
    const memberNames = result.memberNames?.length ? ` · Anggota lain: ${result.memberNames.join(", ")}` : "";
    return `${actionLabel}: ${result.mountainName ?? "Gunung"} · ${result.startDate ?? ""} – ${result.endDate ?? ""} · ${result.groupSize ?? "—"} orang${memberNames}.`;
  }

  useEffect(() => {
    let isCurrent = true;
    fetch("/api/registrations", { cache: "no-store" })
      .then(async (response) => {
        const result = (await response.json()) as {
          registrations?: RegistrationRecord[];
          error?: string;
        };
        if (!response.ok) throw new Error(result.error ?? "Pendaftaran gagal dimuat.");
        return result;
      })
      .then((result) => {
        if (isCurrent) setRegistrations(result.registrations ?? []);
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setErrorMessage(error instanceof Error ? error.message : "Pendaftaran gagal dimuat.");
        }
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  async function updateRegistration(
    registration: RegistrationRecord,
    update: { status?: string },
  ) {
    let note: string | undefined;
    if (update.status === "rejected" || update.status === "revision_requested") {
      const answer = window.prompt(
        update.status === "rejected" ? "Alasan penolakan:" : "Catatan revisi:",
      );
      if (answer === null) return;
      note = answer;
    }
    try {
      const response = await fetch(`/api/registrations/${encodeURIComponent(registration.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...update, note }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Status belum dapat diperbarui.");
      reload();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Status belum dapat diperbarui.");
    }
  }

  return (
    <section className="dashboard-panel admin-operation-panel" id="registration-operations">
      <div className="staff-section-heading">
        <div>
          <h2>{fieldOnly ? "Manifest dan check-in" : "Pendaftaran pendakian"}</h2>
          <p>
            {fieldOnly
              ? "Data kontak dan identitas sensitif tidak ditampilkan pada manifest lapangan."
              : "Periksa permohonan dan setujui, tolak, atau minta revisi."}
          </p>
        </div>
        <button className="button button-secondary" type="button" onClick={reload}>Muat ulang</button>
      </div>
      {["admin", "superadmin", "basecamp_admin", "field_officer"].includes(role) && (
        <QrTicketScanner onScanned={scanTicket} />
      )}
      {errorMessage && <p className="auth-error" role="alert">{errorMessage}</p>}
      {isLoading ? (
        <p>Memuat pendaftaran...</p>
      ) : registrations.length === 0 ? (
        <p>Belum ada pendaftaran untuk Basecamp ini.</p>
      ) : (
        <div className="staff-list">
          {registrations.map((registration) => (
            <article className="staff-card operation-card" key={registration.id}>
              <div>
                <strong>{registration.ownerName ?? "Pendaki"} · {registration.mountainName ?? "Gunung"}</strong>
                <span>{registration.startDate} – {registration.endDate} · {registration.groupSize ?? "—"} orang</span>
                {(registration.memberNames?.length ?? 0) > 0 && (
                  <small>Anggota lain: {registration.memberNames?.join(", ")}</small>
                )}
                {!fieldOnly && registration.ownerEmail && <small>{registration.ownerEmail}</small>}
                {!fieldOnly && registration.emergencyContactName && (
                  <small>Darurat: {registration.emergencyContactName} · {registration.emergencyContactPhone}</small>
                )}
                <small>Status: {registration.status ?? "pending"}{registration.ticketCode ? ` · Tiket ${registration.ticketCode}` : ""}</small>
              </div>
              <div className="operation-actions">
                {fieldOnly ? (
                  null
                ) : ["pending", "revision_requested", "needs_revision"].includes(registration.status ?? "") ? (
                  <>
                    <button className="button button-primary" type="button" onClick={() => void updateRegistration(registration, { status: "approved" })}>Setujui</button>
                    <button className="button button-secondary" type="button" onClick={() => void updateRegistration(registration, { status: "revision_requested" })}>Minta revisi</button>
                    <button className="button button-secondary" type="button" onClick={() => void updateRegistration(registration, { status: "rejected" })}>Tolak</button>
                  </>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function FinanceWorkspace() {
  const [transactions, setTransactions] = useState<LedgerRecord[]>([]);
  const [registrations, setRegistrations] = useState<RegistrationRecord[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function reload() {
    setIsLoading(true);
    fetch("/api/finance", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { transactions?: LedgerRecord[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Data keuangan gagal dimuat.");
        return result;
      })
      .then((result) => {
        setTransactions(result.transactions ?? []);
        setErrorMessage("");
      })
      .catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : "Data keuangan gagal dimuat.");
      })
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    let isCurrent = true;
    fetch("/api/finance", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { transactions?: LedgerRecord[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Data keuangan gagal dimuat.");
        return result;
      })
      .then((result) => {
        if (isCurrent) setTransactions(result.transactions ?? []);
      })
      .catch((error: unknown) => {
        if (isCurrent) setErrorMessage(error instanceof Error ? error.message : "Data keuangan gagal dimuat.");
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    let isCurrent = true;
    fetch("/api/registrations", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as {
          registrations?: RegistrationRecord[];
          error?: string;
        };
        if (!response.ok) throw new Error(result.error ?? "Daftar pendaftaran gagal dimuat.");
        return result;
      })
      .then((result) => {
        if (isCurrent) setRegistrations(result.registrations ?? []);
      })
      .catch((error: unknown) => {
        if (isCurrent) setErrorMessage(error instanceof Error ? error.message : "Daftar pendaftaran gagal dimuat.");
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  async function createTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      registrationId: String(data.get("registrationId") ?? ""),
      type: String(data.get("type") ?? ""),
      amount: Number(data.get("amount")),
      method: String(data.get("method") ?? ""),
      note: String(data.get("note") ?? ""),
    };
    try {
      const response = await fetch("/api/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Transaksi belum dapat dicatat.");
      form.reset();
      reload();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Transaksi belum dapat dicatat.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="dashboard-panel admin-operation-panel" id="finance-operations">
      <h2>Keuangan</h2>
      <p>Catat tagihan sebelum pembayaran. Nilai transaksi menggunakan rupiah.</p>
      {errorMessage && <p className="auth-error" role="alert">{errorMessage}</p>}
      <form className="dashboard-form-grid" onSubmit={createTransaction}>
        <label className="form-field">Pendaftaran
          <select name="registrationId" defaultValue="" required>
            <option value="" disabled>Pilih pendaftaran</option>
            {registrations.map((registration) => (
              <option key={registration.id} value={registration.id}>
                {registration.ownerName ?? "Pendaki"} · {registration.mountainName ?? "Gunung"} · {registration.startDate}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">Jenis transaksi
          <select name="type" defaultValue="charge">
            <option value="charge">Tagihan</option><option value="payment">Pembayaran</option><option value="refund">Refund</option>
          </select>
        </label>
        <label className="form-field">Jumlah (Rp)<input name="amount" type="number" min="1" step="1" required /></label>
        <label className="form-field">Metode
          <select name="method" defaultValue="bank_transfer">
            <option value="bank_transfer">Transfer bank</option><option value="cash">Tunai</option><option value="other">Lainnya</option>
          </select>
        </label>
        <label className="form-field">Catatan (opsional)<input name="note" maxLength={500} /></label>
        <button className="button button-primary" disabled={isSubmitting}>{isSubmitting ? "Menyimpan..." : "Catat transaksi"}</button>
      </form>
      <div className="staff-list">
        <h3>Transaksi terbaru</h3>
        {isLoading ? <p>Memuat transaksi...</p> : transactions.length === 0 ? <p>Belum ada transaksi.</p> : transactions.map((item) => (
          <article className="staff-card" key={item.id}>
            <div><strong>{item.type} · Rp {item.amount.toLocaleString("id-ID")}</strong><small>Pendaftaran {item.registrationId} · {item.method}{item.note ? ` · ${item.note}` : ""}</small></div>
          </article>
        ))}
      </div>
    </section>
  );
}

function InformationWorkspace() {
  const [records, setRecords] = useState<InfoRecord[]>([]);
  const [type, setType] = useState<InfoRecord["type"]>("mountain");
  const [recordId, setRecordId] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [location, setLocation] = useState("");
  const [elevation, setElevation] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [status, setStatus] = useState("Buka");
  const [quota, setQuota] = useState("");
  const [visibility, setVisibility] = useState<"public" | "draft">("public");
  const [errorMessage, setErrorMessage] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    fetch("/api/basecamp/information", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as {
          mountains?: MountainData[];
          announcements?: AnnouncementData[];
          error?: string;
        };
        if (!response.ok) throw new Error(result.error ?? "Informasi Basecamp gagal dimuat.");
        return result;
      })
      .then((result) => {
        if (!isCurrent) return;
        const mountains: InfoRecord[] = (result.mountains ?? []).map((item) => ({
          ...item,
          type: "mountain",
          title: item.name ?? "",
          content: item.description ?? "",
          visibility: item.visibility === "draft" ? "draft" : "public",
        }));
        const announcements: InfoRecord[] = (result.announcements ?? []).map((item) => ({
          ...item,
          type: "announcement",
          title: item.title ?? "",
          content: item.body ?? "",
          visibility: item.visibility === "draft" ? "draft" : "public",
        }));
        setRecords([...mountains, ...announcements]);
      })
      .catch((error: unknown) => {
        if (isCurrent) setErrorMessage(error instanceof Error ? error.message : "Informasi Basecamp gagal dimuat.");
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  function selectRecord(id: string) {
    setRecordId(id);
    const record = records.find((item) => item.id === id);
    if (!record) {
      setTitle("");
      setContent("");
      setLocation("");
      setElevation("");
      setLatitude("");
      setLongitude("");
      setStatus("Buka");
      setQuota("");
      setVisibility("public");
      return;
    }
    setType(record.type);
    setTitle(record.title);
    setContent(record.content);
    setLocation(record.location ?? "");
    setElevation(record.elevation ?? "");
    setLatitude(record.latitude == null ? "" : String(record.latitude));
    setLongitude(record.longitude == null ? "" : String(record.longitude));
    setStatus(record.status ?? "Buka");
    setQuota(record.quota == null ? "" : String(record.quota));
    setVisibility(record.visibility);
  }

  async function saveInformation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setMessage("");
    setIsSubmitting(true);
    const payload = {
      type,
      ...(recordId ? { id: recordId } : {}),
      title,
      content,
      location,
      elevation,
      latitude: latitude.trim() ? Number(latitude) : null,
      longitude: longitude.trim() ? Number(longitude) : null,
      status,
      ...(quota ? { quota: Number(quota) } : {}),
      visibility,
    };
    try {
      const response = await fetch("/api/basecamp/information", {
        method: recordId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { error?: string; id?: string };
      if (!response.ok) throw new Error(result.error ?? "Informasi belum dapat disimpan.");
      const savedRecord: InfoRecord = {
        id: recordId || result.id || "",
        type,
        title,
        content,
        location,
        elevation,
        latitude: latitude.trim() ? Number(latitude) : null,
        longitude: longitude.trim() ? Number(longitude) : null,
        status,
        quota: quota ? Number(quota) : null,
        visibility,
      };
      setRecords((current) =>
        recordId
          ? current.map((record) => record.id === recordId ? savedRecord : record)
          : [...current, savedRecord],
      );
      setMessage("Informasi berhasil disimpan.");
      setRecordId("");
      setTitle("");
      setContent("");
      setLocation("");
      setElevation("");
      setLatitude("");
      setLongitude("");
      setQuota("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Informasi belum dapat disimpan.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const visibleRecords = records.filter((record) => record.type === type);
  return (
    <section className="dashboard-panel admin-operation-panel" id="information-operations">
      <h2>Informasi Basecamp</h2>
      <p>Kelola informasi yang ditampilkan secara publik. Data pribadi pendaki tidak tersedia di sini.</p>
      {message && <p role="status">{message}</p>}
      {errorMessage && <p className="auth-error" role="alert">{errorMessage}</p>}
      <form className="dashboard-form-grid" onSubmit={saveInformation}>
        <label className="form-field">Jenis informasi
          <select value={type} onChange={(event) => { setType(event.target.value as InfoRecord["type"]); selectRecord(""); }}>
            <option value="mountain">Gunung</option><option value="announcement">Pengumuman</option>
          </select>
        </label>
        <label className="form-field">Pilih untuk diedit (opsional)
          <select value={recordId} onChange={(event) => selectRecord(event.target.value)}>
            <option value="">Tambah baru</option>
            {visibleRecords.map((record) => <option key={record.id} value={record.id}>{record.title}</option>)}
          </select>
        </label>
        <label className="form-field">{type === "mountain" ? "Nama gunung" : "Judul pengumuman"}
          <input value={title} onChange={(event) => setTitle(event.target.value)} minLength={2} maxLength={120} required />
        </label>
        {type === "mountain" ? (
          <>
            <label className="form-field">Lokasi<input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={120} /></label>
            <label className="form-field">Ketinggian<input value={elevation} onChange={(event) => setElevation(event.target.value)} maxLength={40} /></label>
            <label className="form-field">Latitude pusat peta<input type="number" min="-90" max="90" step="any" value={latitude} onChange={(event) => setLatitude(event.target.value)} /><span>Opsional; koordinat gunung/basecamp untuk unduh peta offline.</span></label>
            <label className="form-field">Longitude pusat peta<input type="number" min="-180" max="180" step="any" value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label>
            <label className="form-field">Status jalur<input value={status} onChange={(event) => setStatus(event.target.value)} minLength={2} maxLength={80} required /><span>Hanya status “Buka” atau “Dibuka” yang menerima pengajuan pendakian.</span></label>
            <label className="form-field">Kuota (opsional)<input type="number" min="0" step="1" value={quota} onChange={(event) => setQuota(event.target.value)} /></label>
          </>
        ) : null}
        <label className="form-field">{type === "mountain" ? "Deskripsi" : "Isi pengumuman"}
          <textarea value={content} onChange={(event) => setContent(event.target.value)} minLength={5} maxLength={2000} required />
        </label>
        <label className="form-field">Visibilitas
          <select value={visibility} onChange={(event) => setVisibility(event.target.value as "public" | "draft")}>
            <option value="public">Publik</option><option value="draft">Draf</option>
          </select>
        </label>
        <button className="button button-primary" disabled={isSubmitting}>{isSubmitting ? "Menyimpan..." : recordId ? "Simpan perubahan" : "Tambah informasi"}</button>
      </form>
    </section>
  );
}

export function OperationsWorkspace({
  role,
  section,
}: {
  role: UserRole;
  section: "registrations" | "finance" | "information";
}) {
  if (section === "registrations" && canUse(role, "registration")) {
    return <RegistrationWorkspace role={role} />;
  }
  if (section === "finance" && canUse(role, "finance")) {
    return <FinanceWorkspace />;
  }
  if (section === "information" && canUse(role, "information")) {
    return <InformationWorkspace />;
  }
  return null;
}
