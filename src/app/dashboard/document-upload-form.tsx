"use client";

import { useState, type FormEvent } from "react";

const MAX_FILE_SIZE = 3 * 1024 * 1024;

export function DocumentUploadForm({ onUploaded }: { onUploaded?: () => void }) {
  const [message, setMessage] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("document");
    if (!(fileInput instanceof HTMLInputElement) || !fileInput.files?.[0]) {
      setMessage("Pilih dokumen yang ingin diunggah.");
      return;
    }

    const file = fileInput.files[0];
    if (file.size > MAX_FILE_SIZE) {
      setMessage("Ukuran dokumen maksimal 3 MB.");
      return;
    }

    setIsUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Dokumen tidak dapat dibaca."));
        reader.onload = () => {
          if (typeof reader.result !== "string") {
            reject(new Error("Dokumen tidak dapat dibaca."));
            return;
          }
          const separator = reader.result.indexOf(",");
          if (separator < 0) {
            reject(new Error("Format dokumen tidak valid."));
            return;
          }
          resolve(reader.result.slice(separator + 1));
        };
        reader.readAsDataURL(file);
      });
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          mimeType: file.type,
          base64,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "Dokumen gagal diunggah.");
      }
      setMessage("Dokumen berhasil disimpan secara privat di Google Drive.");
      form.reset();
      onUploaded?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Dokumen gagal diunggah.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="dashboard-panel">
      <h2>Dokumen pendakian</h2>
      <p>
        Simpan dokumen PDF atau gambar dengan aman. File disimpan di Google
        Drive; data pemilik dan statusnya dicatat di Firestore.
      </p>
      <form className="inline-form" onSubmit={handleSubmit}>
        <input
          aria-label="Pilih dokumen"
          type="file"
          name="document"
          accept="application/pdf,image/jpeg,image/png"
          required
        />
        <button className="button button-primary" disabled={isUploading}>
          {isUploading ? "Mengunggah..." : "Unggah dokumen"}
        </button>
      </form>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
