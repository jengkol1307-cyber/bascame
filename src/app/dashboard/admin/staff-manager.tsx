"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ROLE_LABELS, STAFF_ROLES, type UserRole } from "@/lib/auth/roles";

type StaffRecord = {
  id: string;
  uid: string;
  fullName: string;
  username: string;
  email: string;
  phone?: string;
  role: UserRole;
};

export function StaffManager() {
  const [staff, setStaff] = useState<StaffRecord[]>([]);
  const [currentUserUid, setCurrentUserUid] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadStaff = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/staff", { cache: "no-store" });
      const result = (await response.json()) as {
        staff?: StaffRecord[];
        currentUserUid?: string;
        error?: string;
      };
      setErrorMessage("");
      if (!response.ok) throw new Error(result.error ?? "Daftar staf gagal dimuat.");
      setStaff(result.staff ?? []);
      setCurrentUserUid(result.currentUserUid ?? "");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Daftar staf gagal dimuat.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isCurrent = true;
    fetch("/api/admin/staff", { cache: "no-store" })
      .then(async (response) => {
        const result = (await response.json()) as {
          staff?: StaffRecord[];
          currentUserUid?: string;
          error?: string;
        };
        if (!response.ok) throw new Error(result.error ?? "Daftar staf gagal dimuat.");
        return result;
      })
      .then((result) => {
        if (isCurrent) {
          setStaff(result.staff ?? []);
          setCurrentUserUid(result.currentUserUid ?? "");
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setErrorMessage(error instanceof Error ? error.message : "Daftar staf gagal dimuat.");
        }
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  async function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setErrorMessage("");
    setIsSubmitting(true);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data.entries())),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Akun staf belum dapat dibuat.");
      form.reset();
      setMessage("Akun staf berhasil dibuat. Minta staf mengganti sandi saat pertama masuk.");
      await loadStaff();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Akun staf belum dapat dibuat.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function removeStaff(member: StaffRecord) {
    if (!window.confirm(`Cabut akses staf ${member.fullName}?`)) return;
    setMessage("");
    setErrorMessage("");
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/staff", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: member.uid }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Akses staf belum dapat dicabut.");
      setMessage(`Akses ${member.fullName} telah dicabut.`);
      await loadStaff();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Akses staf belum dapat dicabut.");
    }
  }

  return (
    <section className="dashboard-panel admin-operation-panel" id="staff-management">
      <h2>Manajemen akun staf</h2>
      <p>Buat akun staf untuk Basecamp ini saja. Sandi sementara wajib diganti saat login pertama.</p>
      {message && <p role="status">{message}</p>}
      {errorMessage && <p className="auth-error" role="alert">{errorMessage}</p>}
      <form className="dashboard-form-grid" onSubmit={createStaff}>
        <label className="form-field">
          Nama lengkap
          <input name="fullName" autoComplete="name" minLength={2} maxLength={100} required />
        </label>
        <label className="form-field">
          Username
          <input name="username" autoComplete="username" minLength={3} maxLength={30} pattern="[a-zA-Z0-9._-]+" required />
        </label>
        <label className="form-field">
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label className="form-field">
          Telepon (opsional)
          <input name="phone" type="tel" autoComplete="tel" maxLength={32} />
        </label>
        <label className="form-field">
          Peran
          <select name="role" defaultValue="registration_operator">
            {STAFF_ROLES.map((role) => (
              <option key={role} value={role}>{ROLE_LABELS[role]}</option>
            ))}
          </select>
        </label>
        <label className="form-field">
          Sandi sementara
          <input name="temporaryPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
        </label>
        <button className="button button-primary" disabled={isSubmitting}>
          {isSubmitting ? "Membuat akun..." : "Buat akun staf"}
        </button>
      </form>

      <div className="staff-list" aria-live="polite">
        <h3>Staf terdaftar</h3>
        {isLoading ? (
          <p>Memuat daftar staf...</p>
        ) : staff.length === 0 ? (
          <p>Belum ada staf yang ditambahkan.</p>
        ) : (
          staff.map((member) => (
            <article className="staff-card" key={member.uid}>
              <div>
                <strong>{member.fullName}</strong>
                <span>{ROLE_LABELS[member.role] ?? member.role}</span>
                <small>{member.username} · {member.email}</small>
              </div>
              <button className="button button-secondary" type="button" disabled={member.uid === currentUserUid} onClick={() => void removeStaff(member)}>
                {member.uid === currentUserUid ? "Akun Anda" : "Cabut akses"}
              </button>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
