"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

type Item = { id: string; title: string; category: string; done: boolean };
const categories = ["Perlengkapan", "Dokumen", "Kesehatan", "Perjalanan"];

export function ChecklistManager() {
  const [items, setItems] = useState<Item[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(categories[0]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadItems() {
    try {
      const response = await fetch("/api/checklist", { credentials: "same-origin" });
      const result = (await response.json()) as { items?: Item[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Checklist belum dapat dimuat.");
      setItems(result.items ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checklist belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void loadItems(); }, 0);
    return () => window.clearTimeout(initialLoad);
  }, []);
  const completed = useMemo(() => items.filter((item) => item.done).length, [items]);

  async function mutate(method: "POST" | "PATCH" | "DELETE", payload: Record<string, unknown>) {
    setError("");
    const response = await fetch("/api/checklist", {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as { item?: Item; error?: string };
    if (!response.ok) throw new Error(result.error ?? "Checklist belum dapat diperbarui.");
    if (method === "POST" && result.item) setItems((current) => [...current, result.item!]);
    if (method === "PATCH") setItems((current) => current.map((item) => item.id === payload.id ? { ...item, done: payload.done as boolean } : item));
    if (method === "DELETE") setItems((current) => current.filter((item) => item.id !== payload.id));
  }

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await mutate("POST", { title, category });
      setTitle("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Item belum dapat ditambahkan.");
    }
  }

  return (
    <section className="dashboard-panel">
      <div className="hiker-panel-heading">
        <div><span className="eyebrow">PERLENGKAPAN & PERSIAPAN</span><h2>Checklist pendakian</h2></div>
        <span className="hiker-count">{completed}/{items.length} selesai</span>
      </div>
      <p>Tandai persiapan yang sudah siap atau tambahkan kebutuhan khusus untuk perjalananmu.</p>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <form className="hiker-form hiker-checklist-form" onSubmit={addItem}>
        <label className="form-field">Persiapan baru<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} minLength={2} required placeholder="Contoh: Bawa jas hujan" /></label>
        <label className="form-field">Kategori<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((value) => <option key={value}>{value}</option>)}</select></label>
        <button className="button button-primary">Tambah</button>
      </form>
      {loading ? <p>Memuat checklist...</p> : items.length === 0 ? (
        <div className="hiker-empty"><strong>Checklist masih kosong.</strong><span>Tambahkan kebutuhan persiapan pendakianmu.</span></div>
      ) : (
        <div className="hiker-checklist-groups">
          {categories.map((group) => {
            const groupItems = items.filter((item) => item.category === group);
            if (!groupItems.length) return null;
            return <div className="hiker-checklist-group" key={group}>
              <h3>{group}</h3>
              {groupItems.map((item) => <div className="hiker-checklist-item" key={item.id}>
                <label><input type="checkbox" checked={item.done} onChange={async (event) => {
                  const done = event.target.checked;
                  setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, done } : entry));
                  try { await mutate("PATCH", { id: item.id, done }); } catch (cause) {
                    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, done: !done } : entry));
                    setError(cause instanceof Error ? cause.message : "Status belum dapat disimpan.");
                  }
                }} /><span className={item.done ? "is-done" : ""}>{item.title}</span></label>
                <button type="button" className="hiker-delete-button" aria-label={`Hapus ${item.title}`} onClick={async () => {
                  try { await mutate("DELETE", { id: item.id }); } catch (cause) {
                    setError(cause instanceof Error ? cause.message : "Item belum dapat dihapus.");
                  }
                }}>Hapus</button>
              </div>)}
            </div>;
          })}
        </div>
      )}
    </section>
  );
}
