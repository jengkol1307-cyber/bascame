"use client";

import { useEffect, useState, type FormEvent } from "react";

type Profile = {
  email: string;
  fullName: string;
  username: string;
  phone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
};

export function ProfileForm() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadProfile() {
      try {
        const response = await fetch("/api/profile", { credentials: "same-origin" });
        const result = (await response.json()) as { profile?: Profile; error?: string };
        if (!response.ok || !result.profile) throw new Error(result.error ?? "Profil belum dapat dimuat.");
        setProfile(result.profile);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Profil belum dapat dimuat.");
      } finally {
        setLoading(false);
      }
    }
    void loadProfile();
  }, []);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setSaving(true);
    setMessage("");
    setError("");
    const values = new FormData(event.currentTarget);
    const payload = {
      fullName: String(values.get("fullName") ?? ""),
      phone: String(values.get("phone") ?? ""),
      emergencyContactName: String(values.get("emergencyContactName") ?? ""),
      emergencyContactPhone: String(values.get("emergencyContactPhone") ?? ""),
    };
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Profil belum dapat disimpan.");
      setProfile({ ...profile, ...payload });
      setMessage("Profil berhasil disimpan.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Profil belum dapat disimpan.");
    } finally {
      setSaving(false);
    }
  }

  async function sendPasswordReset() {
    if (!profile) return;
    setSendingReset(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/profile/password-reset", {
        method: "POST",
        credentials: "same-origin",
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Tautan pemulihan belum dapat dikirim.");
      setMessage(`Tautan untuk mengatur ulang sandi telah dikirim ke ${profile.email}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Tautan pemulihan belum dapat dikirim.");
    } finally {
      setSendingReset(false);
    }
  }

  if (loading) return <section className="dashboard-panel"><p>Memuat profil...</p></section>;
  if (!profile) return <section className="dashboard-panel"><div className="auth-error" role="alert">{error}</div></section>;

  return (
    <section className="dashboard-panel">
      <span className="eyebrow">IDENTITAS & KEAMANAN</span>
      <h2>Profil pendaki</h2>
      <p>Perbarui informasi kontak dan kontak darurat untuk membantu persiapan perjalanan.</p>
      {error && <div className="auth-error" role="alert">{error}</div>}
      {message && <div className="hiker-success" role="status">{message}</div>}
      <form className="hiker-form" onSubmit={saveProfile}>
        <label className="form-field">Nama lengkap<input name="fullName" defaultValue={profile.fullName} minLength={2} maxLength={80} required /></label>
        <div className="hiker-form-row">
          <label className="form-field">Username<input value={profile.username} readOnly /></label>
          <label className="form-field">Email<input type="email" value={profile.email} readOnly /></label>
        </div>
        <label className="form-field">Nomor telepon<input name="phone" type="tel" defaultValue={profile.phone} maxLength={32} /></label>
        <h3>Kontak darurat <span>(opsional)</span></h3>
        <div className="hiker-form-row">
          <label className="form-field">Nama kontak<input name="emergencyContactName" defaultValue={profile.emergencyContactName} maxLength={80} /></label>
          <label className="form-field">Nomor telepon<input name="emergencyContactPhone" type="tel" defaultValue={profile.emergencyContactPhone} maxLength={32} /></label>
        </div>
        <button className="button button-primary" disabled={saving}>{saving ? "Menyimpan..." : "Simpan profil"}</button>
      </form>
      <div className="hiker-security-section">
        <h3>Ubah kata sandi</h3>
        <p>Kami akan mengirim tautan aman dari Firebase ke email akunmu.</p>
        <button className="button button-outline" type="button" onClick={() => void sendPasswordReset()} disabled={sendingReset}>
          {sendingReset ? "Mengirim tautan..." : "Kirim tautan atur ulang sandi"}
        </button>
      </div>
    </section>
  );
}
