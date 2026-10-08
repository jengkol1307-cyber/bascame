"use client";

import { BrowserQRCodeReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { useEffect, useRef, useState, type FormEvent } from "react";

type Props = {
  onScanned: (ticketCode: string, action: "check_in" | "check_out") => Promise<string>;
};

export function QrTicketScanner({ onScanned }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);
  const actionRef = useRef<"check_in" | "check_out">("check_in");
  const [isScanning, setIsScanning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ticketCode, setTicketCode] = useState("");
  const [action, setAction] = useState<"check_in" | "check_out">("check_in");
  const [errorMessage, setErrorMessage] = useState("");
  const [resultMessage, setResultMessage] = useState("");

  useEffect(() => {
    actionRef.current = action;
  }, [action]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controlsRef.current?.stop();
    };
  }, []);

  async function processTicket(code: string) {
    if (processingRef.current) return;
    processingRef.current = true;
    controlsRef.current?.stop();
    setIsScanning(false);
    setIsProcessing(true);
    setErrorMessage("");
    setResultMessage("");
    try {
      setResultMessage(await onScanned(code, actionRef.current));
      setTicketCode("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Tiket belum dapat diproses.");
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }

  async function startScanner() {
    if (!videoRef.current || isScanning || isProcessing) return;
    setErrorMessage("");
    setResultMessage("");
    try {
      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: "environment" } } },
        videoRef.current,
        (result, error, controls) => {
          if (result) {
            controlsRef.current = controls;
            void processTicket(result.getText());
          } else if (
            error &&
            !["NotFoundException", "ChecksumException", "FormatException"].includes(error.name)
          ) {
            setErrorMessage("Kamera gagal membaca QR. Pastikan izin kamera aktif dan QR terlihat jelas.");
          }
        },
      );
      if (!mountedRef.current || processingRef.current) {
        controls.stop();
        return;
      }
      controlsRef.current = controls;
      setIsScanning(true);
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.name === "NotAllowedError"
          ? "Izin kamera ditolak. Aktifkan izin kamera pada browser."
          : "Kamera tidak dapat dibuka. Pastikan perangkat memiliki kamera dan halaman memakai HTTPS.",
      );
    }
  }

  function stopScanner() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setIsScanning(false);
  }

  function submitTicketCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = ticketCode.trim().toUpperCase();
    if (code) void processTicket(code);
  }

  return (
    <div className="qr-scanner-panel">
      <div className="qr-scanner-heading">
        <div>
          <strong>Pindai QR tiket pendaki</strong>
          <span>Pilih tindakan sebelum scan; tiket hanya dapat diproses sesuai status pendaki.</span>
        </div>
        {isScanning ? (
          <button className="button button-secondary" type="button" onClick={stopScanner}>Matikan kamera</button>
        ) : (
          <button className="button button-primary" type="button" disabled={isProcessing} onClick={() => void startScanner()}>
            {isProcessing ? "Memproses tiket..." : "Buka pemindai"}
          </button>
        )}
      </div>
      <div className="qr-scanner-modes" aria-label="Pilih tindakan pemindaian">
        <button
          className={`button ${action === "check_in" ? "button-primary" : "button-secondary"}`}
          type="button"
          aria-pressed={action === "check_in"}
          onClick={() => setAction("check_in")}
        >
          Mode check-in
        </button>
        <button
          className={`button ${action === "check_out" ? "button-primary" : "button-secondary"}`}
          type="button"
          aria-pressed={action === "check_out"}
          onClick={() => setAction("check_out")}
        >
          Mode check-out
        </button>
      </div>
      <video
        ref={videoRef}
        className={`qr-scanner-video${isScanning ? " is-active" : ""}`}
        muted
        playsInline
        aria-label="Tampilan kamera pemindai QR tiket"
      />
      <form className="qr-scanner-manual" onSubmit={submitTicketCode}>
        <label className="form-field">
          Kode tiket jika kamera tidak tersedia
          <input
            value={ticketCode}
            onChange={(event) => setTicketCode(event.target.value)}
            placeholder="BC-..."
            autoComplete="off"
            maxLength={35}
          />
        </label>
        <button className="button button-secondary" type="submit" disabled={isProcessing || !ticketCode.trim()}>
          Proses kode
        </button>
      </form>
      {errorMessage && <p className="auth-error" role="alert">{errorMessage}</p>}
      {resultMessage && <p className="hiker-success" role="status">{resultMessage}</p>}
    </div>
  );
}
