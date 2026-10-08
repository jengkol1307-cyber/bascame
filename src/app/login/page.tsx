"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

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

      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error ?? "Tidak dapat masuk.");
      }

      const result = (await response.json()) as { role?: string };
      const destination =
        result.role === "superadmin"
          ? "/dashboard/superadmin"
          : result.role === "admin"
            ? "/dashboard/admin"
            : "/dashboard";
      window.location.replace(new URL(destination, window.location.origin));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Terjadi kesalahan. Coba lagi.",
      );
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
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
        <form className="auth-form" onSubmit={handleSubmit}>
          <span className="eyebrow">AKUN BASECAMP</span>
          <h2>Selamat datang</h2>
          <p>Masuk menggunakan username atau email.</p>
          {errorMessage && <div className="auth-error" role="alert">{errorMessage}</div>}
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
          <Link className="back-home" href="/">← Kembali ke halaman utama</Link>
        </form>
      </section>
    </main>
  );
}
