"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type BasecampRecord = {
  id: string;
  name: string;
  status?: string;
};

export function BasecampManager() {
  const [basecamps, setBasecamps] = useState<BasecampRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadBasecamps = useCallback(async () => {
    try {
      const response = await fetch("/api/superadmin/basecamps", { cache: "no-store" });
      const result = (await response.json()) as {
        basecamps?: BasecampRecord[];
        error?: string;
      };
      setErrorMessage("");
      if (!response.ok) throw new Error(result.error ?? "Daftar Basecamp gagal dimuat.");
      setBasecamps(result.basecamps ?? []);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Daftar Basecamp gagal dimuat.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isCurrent = true;
    fetch("/api/superadmin/basecamps", { cache: "no-store" })
      .then(async (response) => {
        const result = (await response.json()) as {
          basecamps?: BasecampRecord[];
          error?: string;
        };
        if (!response.ok) throw new Error(result.error ?? "Daftar Basecamp gagal dimuat.");
        return result;
      })
      .then((result) => {
        if (isCurrent) setBasecamps(result.basecamps ?? []);
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setErrorMessage(error instanceof Error ? error.message : "Daftar Basecamp gagal dimuat.");
        }
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  async function createBasecamp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setErrorMessage("");
    setIsSubmitting(true);
    const form = event.currentTarget;
    try {
      const response = await fetch("/api/superadmin/basecamps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Basecamp belum dapat dibuat.");
      form.reset();
      setMessage("Basecamp dan akun Admin Basecamp berhasil dibuat.");
      await loadBasecamps();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Basecamp belum dapat dibuat.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="dashboard-panel">
      <h2>Basecamp dan Admin Basecamp</h2>
      <p>Buat Basecamp sekaligus akun admin pertama. Admin akan mengganti sandi sementara saat masuk.</p>
      {message && <p role="status">{message}</p>}
      {errorMessage && <p className="auth-error" role="alert">{errorMessage}</p>}
      <form className="dashboard-form-grid" onSubmit={createBasecamp}>
        <label className="form-field">
          Nama Basecamp
          <input name="name" minLength={2} maxLength={100} required />
        </label>
        <label className="form-field">
          Nama Admin Basecamp
          <input name="adminName" autoComplete="name" minLength={2} maxLength={100} required />
        </label>
        <label className="form-field">
          Username admin
          <input name="username" autoComplete="username" minLength={3} maxLength={30} pattern="[a-zA-Z0-9._-]+" required />
        </label>
        <label className="form-field">
          Email admin
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label className="form-field">
          Sandi sementara
          <input name="temporaryPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
        </label>
        <button className="button button-primary" disabled={isSubmitting}>
          {isSubmitting ? "Membuat Basecamp..." : "Buat Basecamp"}
        </button>
      </form>
      <div className="staff-list" aria-live="polite">
        <h3>Basecamp terdaftar</h3>
        {isLoading ? (
          <p>Memuat daftar Basecamp...</p>
        ) : basecamps.length === 0 ? (
          <p>Belum ada Basecamp yang dikonfigurasi.</p>
        ) : (
          basecamps.map((basecamp) => (
            <article className="staff-card" key={basecamp.id}>
              <div>
                <strong>{basecamp.name}</strong>
                <small>{basecamp.status ?? "active"} · ID {basecamp.id}</small>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
