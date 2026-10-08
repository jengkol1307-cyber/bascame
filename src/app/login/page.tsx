"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

type AuthResponse = {
  error?: string;
  mustChangePassword?: boolean;
  destination?: string;
};

async function readAuthResponse(response: Response): Promise<AuthResponse> {
  const responseText = await response.text();
  if (!responseText.trim()) {
    throw new Error(
      `Server tidak mengirim respons login (HTTP ${response.status}). Coba lagi, lalu periksa log deployment jika masalah berlanjut.`,
    );
  }

  let result: unknown;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error(
      `Respons server tidak valid (HTTP ${response.status}). Coba lagi, lalu periksa log deployment jika masalah berlanjut.`,
    );
  }
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new Error(`Respons server tidak valid (HTTP ${response.status}).`);
  }
  return result as AuthResponse;
}

export default function LoginPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);
  const [pendingCredentials, setPendingCredentials] = useState<{
    identifier: string;
    password: string;
  } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);
    const formData = new FormData(event.currentTarget);
    const identifier = String(formData.get("identifier") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });

      const result = await readAuthResponse(response);
      if (!response.ok) {
        throw new Error(result.error ?? "Tidak dapat masuk.");
      }
      if (result.mustChangePassword) {
        setPendingCredentials({ identifier, password });
        setPasswordChangeRequired(true);
        setIsSubmitting(false);
        return;
      }
      window.location.replace(
        new URL(result.destination ?? "/dashboard", window.location.origin),
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Terjadi kesalahan. Coba lagi.",
      );
      setIsSubmitting(false);
    }
  }

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingCredentials) return;
    setErrorMessage("");
    setIsSubmitting(true);
    const formData = new FormData(event.currentTarget);
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirmation = String(formData.get("confirmPassword") ?? "");
    if (newPassword !== confirmation) {
      setErrorMessage("Konfirmasi sandi tidak sama.");
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/change-temporary-password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: pendingCredentials.identifier,
          currentPassword: pendingCredentials.password,
          newPassword,
        }),
      });
      const result = await readAuthResponse(response);
      if (!response.ok) throw new Error(result.error ?? "Sandi belum dapat diperbarui.");
      window.location.replace(
        new URL(result.destination ?? "/dashboard", window.location.origin),
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Terjadi kesalahan. Coba lagi.",
      );
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell auth-login-shell">
      <aside className="auth-aside">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">B</span>
          <span>basecamp<span className="brand-period">.</span></span>
        </Link>
        <div className="auth-aside-copy">
          <span className="eyebrow">SATU LANGKAH LEBIH SIAP</span>
          <h1>Petualangan baik dimulai dari persiapan.</h1>
          <p>Masuk untuk mengelola rencana dan informasi pendakianmu.</p>
        </div>
        <span>© 2026 Basecamp</span>
      </aside>
      <section className="auth-main">
        <form
          className="auth-form auth-login-card"
          onSubmit={passwordChangeRequired ? handlePasswordChange : handleSubmit}
        >
          <Link className="brand auth-login-brand" href="/">
            <span className="brand-mark" aria-hidden="true">B</span>
            <span>basecamp<span className="brand-period">.</span></span>
          </Link>
          <span className="eyebrow">AKUN BASECAMP</span>
          <h2>{passwordChangeRequired ? "Buat sandi baru" : "Selamat datang"}</h2>
          <p>
            {passwordChangeRequired
              ? "Demi keamanan, ganti sandi sementara sebelum melanjutkan."
              : "Masuk menggunakan username atau email."}
          </p>
          {errorMessage && <div className="auth-error" role="alert">{errorMessage}</div>}
          {passwordChangeRequired ? (
            <>
              <label className="form-field">
                Sandi baru
                <input
                  type="password"
                  name="newPassword"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                />
              </label>
              <label className="form-field">
                Ulangi sandi baru
                <input
                  type="password"
                  name="confirmPassword"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                />
              </label>
              <button className="button button-primary auth-submit" disabled={isSubmitting}>
                {isSubmitting ? "Memproses..." : "Simpan sandi dan lanjutkan"}
              </button>
            </>
          ) : (
            <>
              <label className="form-field">
                Username atau email
                <input
                  type="text"
                  name="identifier"
                  autoComplete="username"
                  required
                />
              </label>
              <label className="form-field">
                Kata sandi
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  minLength={6}
                  required
                />
              </label>
              <button className="button button-primary auth-submit" disabled={isSubmitting}>
                {isSubmitting ? "Memproses..." : "Masuk"}
              </button>
              <p className="auth-switch">
                Belum punya akun? <Link href="/register">Daftar sebagai pendaki</Link>
              </p>
            </>
          )}
          <Link className="back-home" href="/">← Kembali ke halaman utama</Link>
        </form>
      </section>
    </main>
  );
}
