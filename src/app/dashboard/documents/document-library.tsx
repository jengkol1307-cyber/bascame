"use client";

import { useCallback, useEffect, useState } from "react";
import { DocumentUploadForm } from "../document-upload-form";

type DocumentItem = {
  id: string;
  fileName: string;
  mimeType: string;
  status: string;
  createdAt: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "Waktu unggah tidak tersedia";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function DocumentLibrary() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState("");

  const loadDocuments = useCallback(async () => {
    try {
      const response = await fetch("/api/documents/mine", { credentials: "same-origin" });
      const result = (await response.json()) as {
        documents?: DocumentItem[];
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "Dokumen belum dapat dimuat.");
      setDocuments(result.documents ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dokumen belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void loadDocuments(); }, 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadDocuments]);

  async function deleteDocument(document: DocumentItem) {
    if (!window.confirm(`Hapus dokumen "${document.fileName}" dari Drive?`)) return;
    setError("");
    setDeletingId(document.id);
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(document.id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Dokumen belum dapat dihapus.");
      setDocuments((current) => current.filter((entry) => entry.id !== document.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dokumen belum dapat dihapus.");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <div className="hiker-page-stack">
      <DocumentUploadForm onUploaded={() => void loadDocuments()} />
      <section className="dashboard-panel">
        <div className="hiker-panel-heading">
          <div><span className="eyebrow">ARSIP PRIBADI</span><h2>Dokumen tersimpan</h2></div>
          <span className="hiker-count">{documents.length} dokumen</span>
        </div>
        <p>File disimpan secara privat di Google Drive. Hanya metadata dokumen yang tersimpan di Firestore.</p>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {loading ? <p>Memuat dokumen...</p> : documents.length === 0 ? (
          <div className="hiker-empty"><strong>Belum ada dokumen.</strong><span>Unggah dokumen PDF atau gambar di atas untuk mulai menyiapkan arsip perjalanan.</span></div>
        ) : (
          <div className="hiker-list">
            {documents.map((document) => (
              <article className="hiker-list-row" key={document.id}>
                <span className="hiker-list-icon" aria-hidden="true">▤</span>
                <div className="hiker-list-content">
                  <strong>{document.fileName}</strong>
                  <span>{document.mimeType} · {formatDate(document.createdAt)}</span>
                </div>
                <span className="hiker-badge">{document.status === "stored" ? "Tersimpan" : document.status}</span>
                <a className="hiker-document-action" href={`/api/documents/${encodeURIComponent(document.id)}`}>Unduh</a>
                <button
                  className="hiker-document-action hiker-document-delete"
                  type="button"
                  disabled={deletingId === document.id}
                  onClick={() => void deleteDocument(document)}
                >
                  {deletingId === document.id ? "Menghapus..." : "Hapus"}
                </button>
              </article>
            ))}
          </div>
        )}
        <p className="hiker-disclaimer">Unggah hanya dokumen yang diminta pengelola. Tautan dan isi dokumen tidak dipublikasikan.</p>
      </section>
    </div>
  );
}
