"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  createUserWithEmailAndPassword,
  getIdToken,
  type User,
} from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/client";

export default function RegisterPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);
    const formData = new FormData(event.currentTarget);
    const fullName = String(formData.get("fullName") ?? "").trim();
    const username = String(formData.get("username") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    let createdUser: User | null = null;
    try {
      const auth = getFirebaseAuth();
      if (
        auth.currentUser &&
        auth.currentUser.email?.toLowerCase() === email.toLowerCase()
      ) {
        createdUser = auth.currentUser;
      } else {
        const credential = await createUserWithEmailAndPassword(
          auth,
          email,
          password,
        );
        createdUser = credential.user;
      }

      const idToken = await getIdToken(createdUser, true);
      const registrationResponse = await fetch("/api/auth/register", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, fullName, username, phone }),
      });
      const registrationResult = (await registrationResponse.json()) as {
        error?: string;
      };
      if (!registrationResponse.ok) {
        throw new Error(registrationResult.error ?? "Pendaftaran gagal.");
      }

      const refreshedIdToken = await getIdToken(createdUser, true);
      const sessionResponse = await fetch("/api/auth/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: refreshedIdToken }),
      });
      if (!sessionResponse.ok) {
        const sessionResult = (await sessionResponse.json()) as { error?: string };
        throw new Error(sessionResult.error ?? "Akun dibuat, tetapi sesi gagal dimulai. Silakan masuk.");
      }

      window.location.replace(new URL("/dashboard", window.location.origin));
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Pendaftaran gagal. Periksa data lalu coba kembali.",
      );
    } finally {
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
          <span className="eyebrow">LANGKAH PERTAMA PETUALANGANMU</span>
          <h1>Kenali jalurnya. Siapkan perjalanannya.</h1>
          <p>
            Buat akun untuk menyimpan informasi dan dokumen pendakianmu di satu
            tempat.
          </p>
        </div>
        <span>© 2026 Basecamp</span>
      </aside>

      <section className="auth-main">
        <form className="auth-form" onSubmit={handleSubmit}>
          <span className="eyebrow">AKUN PENDAKI</span>
          <h2>Buat akun pendaki</h2>
          <p>Daftar untuk mulai menyiapkan perjalanan pendakian.</p>
          {errorMessage && (
            <div className="auth-error" role="alert">{errorMessage}</div>
          )}
          <label className="form-field">
            Nama lengkap
            <input
              type="text"
              name="fullName"
              autoComplete="name"
              minLength={2}
              maxLength={80}
              required
            />
          </label>
          <label className="form-field">
            Username
            <input
              type="text"
              name="username"
              autoComplete="username"
              minLength={3}
              maxLength={20}
              pattern="[A-Za-z0-9_]{3,20}"
              title="3–20 karakter, gunakan huruf, angka, atau garis bawah."
              required
            />
          </label>
          <label className="form-field">
            Email
            <input type="email" name="email" autoComplete="email" required />
          </label>
          <label className="form-field">
            Nomor telepon <span>(opsional)</span>
            <input type="tel" name="phone" autoComplete="tel" maxLength={32} />
          </label>
          <label className="form-field">
            Kata sandi
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              minLength={6}
              maxLength={128}
              required
            />
          </label>
          <button
            className="button button-primary auth-submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Membuat akun..." : "Daftar sebagai pendaki"}
          </button>
          <p className="auth-switch">
            Sudah punya akun? <Link href="/login">Masuk</Link>
          </p>
          <Link className="back-home" href="/">← Kembali ke halaman utama</Link>
        </form>
      </section>
    </main>
  );
}
