"use client";

import { useEffect, useState } from "react";

type SosStatus = "open" | "acknowledged" | "dispatched" | "resolved" | "false_alarm";
type SosCategory = "medical" | "injury" | "lost" | "other";

type SosLocation = {
  latitude: number;
  longitude: number;
  accuracy?: number;
};

type SosHistoryEntry = {
  status: string;
  changedByName: string;
  note: string;
  at: string;
};

type SosIncident = {
  id: string;
  registrationId: string;
  ownerName: string;
  ownerPhone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  mountainName: string;
  category: SosCategory;
  description: string;
  status: SosStatus;
  location: SosLocation | null;
  createdAt: string | null;
  updatedAt: string | null;
  history: SosHistoryEntry[];
};

type HikerTrip = {
  id: string;
  mountainName: string;
  startDate: string;
  endDate: string;
  status: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
};

const ACTIVE_SOS_STATUSES: SosStatus[] = ["open", "acknowledged", "dispatched"];

const SOS_STATUS_LABELS: Record<SosStatus, string> = {
  open: "Baru",
  acknowledged: "Diterima petugas",
  dispatched: "Tim bantuan bergerak",
  resolved: "Selesai",
  false_alarm: "Laporan tidak valid",
};

const SOS_CATEGORY_LABELS: Record<SosCategory, string> = {
  medical: "Kondisi medis",
  injury: "Cedera/kecelakaan",
  lost: "Tersesat",
  other: "Keadaan darurat lain",
};

function formatIncidentDate(value: string | null) {
  if (!value) return "Waktu tidak tersedia";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Waktu tidak tersedia";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(date);
}

function responseError(payload: { error?: string }, fallback: string) {
  return payload.error ?? fallback;
}

async function readSosResponse(response: Response) {
  return (await response.json()) as { incidents?: SosIncident[]; error?: string };
}

function requestDeviceLocation(): Promise<{ location: SosLocation | null; error: string }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ location: null, error: "Perangkat tidak menyediakan lokasi GPS." });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({
        location: {
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
        },
        error: "",
      }),
      () => resolve({ location: null, error: "Lokasi GPS tidak tersedia atau izinnya ditolak." }),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 },
    );
  });
}

export function HikerSosPanel({ trips }: { trips: HikerTrip[] }) {
  const [incidents, setIncidents] = useState<SosIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmingTripId, setConfirmingTripId] = useState("");
  const [category, setCategory] = useState<SosCategory>("medical");
  const [description, setDescription] = useState("");
  const [sendingTripId, setSendingTripId] = useState("");
  const [locationNotice, setLocationNotice] = useState("");
  const activeTrips = trips.filter((trip) => trip.status === "checked_in");
  const tripIds = new Set(trips.map((trip) => trip.id));
  const visibleIncidents = incidents.filter((incident) => tripIds.has(incident.registrationId));

  async function loadIncidents() {
    try {
      const response = await fetch("/api/sos", { cache: "no-store", credentials: "same-origin" });
      const result = await readSosResponse(response);
      if (!response.ok) throw new Error(responseError(result, "Laporan SOS belum dapat dimuat."));
      setIncidents(result.incidents ?? []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Laporan SOS belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void loadIncidents(); }, 0);
    return () => window.clearTimeout(initialLoad);
  }, []);

  async function sendSos(trip: HikerTrip) {
    setError("");
    setNotice("");
    setLocationNotice("");
    setSendingTripId(trip.id);
    const locationPromise = requestDeviceLocation();

    try {
      const response = await fetch("/api/sos", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registrationId: trip.id,
          category,
          description: description.trim(),
        }),
      });
      const result = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !result.id) {
        throw new Error(responseError(result, "SOS belum dapat dikirim."));
      }
      setNotice(`SOS untuk ${trip.mountainName} sudah tercatat. Hubungi Basecamp melalui telepon juga.`);
      setConfirmingTripId("");
      setDescription("");
      await loadIncidents();
      void locationPromise.then(async ({ location, error: locationError }) => {
        if (!location) {
          setLocationNotice(`SOS sudah terkirim, tetapi ${locationError} Sampaikan lokasi Anda melalui telepon/radio.`);
          return;
        }
        try {
          const locationResponse = await fetch("/api/sos", {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ incidentId: result.id, operation: "location", location }),
          });
          const locationResult = (await locationResponse.json()) as { error?: string };
          if (!locationResponse.ok) {
            throw new Error(responseError(locationResult, "Lokasi belum dapat dibagikan."));
          }
          setLocationNotice("Lokasi GPS berhasil dibagikan kepada petugas.");
          await loadIncidents();
        } catch (cause) {
          setLocationNotice(
            `SOS sudah terkirim, tetapi lokasi GPS belum tersimpan: ${
              cause instanceof Error ? cause.message : "terjadi kesalahan"
            }`,
          );
        }
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "SOS belum dapat dikirim.");
    } finally {
      setSendingTripId("");
    }
  }

  if (trips.length === 0) return null;

  return (
    <section className="dashboard-panel hiker-sos-panel" aria-labelledby="hiker-sos-title">
      <div className="hiker-panel-heading">
        <div>
          <span className="eyebrow">KESELAMATAN PENDAKI</span>
          <h2 id="hiker-sos-title">SOS & bantuan darurat</h2>
        </div>
        <span className="sos-live-indicator"><i /> Kanal Basecamp</span>
      </div>
      <p className="sos-safety-note">
        Laporan ini masuk ke dashboard petugas Basecamp. Untuk bahaya yang mengancam nyawa,
        segera hubungi Basecamp melalui telepon atau radio juga; jangan menunggu balasan aplikasi.
      </p>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {notice && <p className="hiker-success" role="status">{notice}</p>}
      {locationNotice && <p className="sos-location-note" role="status">{locationNotice}</p>}

      {activeTrips.length > 0 ? (
        <div className="sos-hiker-trips">
          {activeTrips.map((trip) => {
            const incident = visibleIncidents.find(
              (item) => item.registrationId === trip.id && ACTIVE_SOS_STATUSES.includes(item.status),
            );
            return (
              <article className="sos-hiker-trip" key={trip.id}>
                <div className="sos-hiker-trip-heading">
                  <div><strong>{trip.mountainName}</strong><span>{trip.startDate} – {trip.endDate}</span></div>
                  {incident && (
                    <span className={`sos-status sos-status-${incident.status}`}>
                      {SOS_STATUS_LABELS[incident.status]}
                    </span>
                  )}
                </div>
                {incident ? (
                  <div className="sos-hiker-active">
                    <p><strong>{SOS_CATEGORY_LABELS[incident.category]}</strong> · {formatIncidentDate(incident.createdAt)}</p>
                    {incident.description && <p>{incident.description}</p>}
                    <div className="sos-history">
                      {incident.history.map((entry, index) => (
                        <div key={`${incident.id}-${entry.at}-${index}`}>
                          <strong>{SOS_STATUS_LABELS[entry.status as SosStatus] ?? entry.status}</strong>
                          <span>{entry.changedByName} · {formatIncidentDate(entry.at)}</span>
                          {entry.note && <small>{entry.note}</small>}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : confirmingTripId === trip.id ? (
                  <div className="sos-hiker-form">
                    <label className="form-field">Jenis keadaan darurat
                      <select value={category} onChange={(event) => setCategory(event.target.value as SosCategory)}>
                        {Object.entries(SOS_CATEGORY_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="form-field">Keterangan singkat <span>(opsional)</span>
                      <textarea
                        maxLength={1000}
                        rows={3}
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder="Contoh: cedera kaki di sekitar pos..."
                      />
                    </label>
                    {trip.emergencyContactName && (
                      <small>Kontak darurat: {trip.emergencyContactName} · {trip.emergencyContactPhone}</small>
                    )}
                    <div className="hiker-trip-actions">
                      <button
                        className="button button-sos"
                        type="button"
                        disabled={Boolean(sendingTripId)}
                        onClick={() => void sendSos(trip)}
                      >
                        {sendingTripId === trip.id ? "Mengirim SOS..." : "Konfirmasi & kirim SOS"}
                      </button>
                      <button
                        className="button button-outline"
                        type="button"
                        disabled={Boolean(sendingTripId)}
                        onClick={() => setConfirmingTripId("")}
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="button button-sos sos-send-button"
                    type="button"
                    onClick={() => { setError(""); setConfirmingTripId(trip.id); }}
                  >
                    SOS · Minta bantuan
                  </button>
                )}
              </article>
            );
          })}
        </div>
      ) : loading ? (
        <p>Memeriksa laporan SOS...</p>
      ) : visibleIncidents.length === 0 ? (
        <p className="sos-no-active">Tombol SOS tersedia setelah petugas melakukan check-in pendakian.</p>
      ) : null}

      {visibleIncidents.some((incident) => !ACTIVE_SOS_STATUSES.includes(incident.status)) && (
        <details className="sos-history-details">
          <summary>Riwayat laporan SOS</summary>
          <div className="sos-hiker-trips">
            {visibleIncidents
              .filter((incident) => !ACTIVE_SOS_STATUSES.includes(incident.status))
              .map((incident) => (
                <article className="sos-hiker-trip" key={incident.id}>
                  <div className="sos-hiker-trip-heading">
                    <div><strong>{incident.mountainName}</strong><span>{formatIncidentDate(incident.createdAt)}</span></div>
                    <span className={`sos-status sos-status-${incident.status}`}>
                      {SOS_STATUS_LABELS[incident.status]}
                    </span>
                  </div>
                </article>
              ))}
          </div>
        </details>
      )}
    </section>
  );
}

export function SosManager() {
  const [incidents, setIncidents] = useState<SosIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [updatingId, setUpdatingId] = useState("");

  async function loadIncidents() {
    try {
      const response = await fetch("/api/sos", { cache: "no-store" });
      const result = await readSosResponse(response);
      if (!response.ok) throw new Error(responseError(result, "Laporan SOS belum dapat dimuat."));
      setIncidents(result.incidents ?? []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Laporan SOS belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let timeoutId = 0;
    async function poll() {
      if (cancelled) return;
      await loadIncidents();
      if (!cancelled) timeoutId = window.setTimeout(() => void poll(), 15_000);
    }
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, []);

  async function updateIncident(
    incident: SosIncident,
    operation: "acknowledge" | "dispatch" | "resolve" | "false_alarm",
  ) {
    setError("");
    setUpdatingId(incident.id);
    try {
      const response = await fetch("/api/sos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incidentId: incident.id,
          operation,
          note: notes[incident.id] ?? "",
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(responseError(result, "Laporan SOS belum dapat diperbarui."));
      setNotes((current) => ({ ...current, [incident.id]: "" }));
      await loadIncidents();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Laporan SOS belum dapat diperbarui.");
    } finally {
      setUpdatingId("");
    }
  }

  return (
    <section className="dashboard-panel admin-operation-panel sos-manager" id="sos-operations">
      <div className="staff-section-heading">
        <div>
          <span className="admin-kicker">TANGGAP DARURAT</span>
          <h2>Manajemen SOS pendaki</h2>
          <p>Daftar diperbarui otomatis setiap 15 detik selama halaman ini terbuka.</p>
        </div>
        <button className="button button-secondary" type="button" onClick={() => void loadIncidents()}>
          Muat ulang
        </button>
      </div>
      <p className="sos-safety-note">
        Dashboard ini adalah kanal laporan dalam aplikasi, bukan layanan SAR otomatis. Tetap
        gunakan telepon/radio dan prosedur evakuasi Basecamp untuk mengirim bantuan.
      </p>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {loading ? (
        <p>Memuat laporan SOS...</p>
      ) : incidents.length === 0 ? (
        <div className="sos-no-active">Belum ada laporan SOS.</div>
      ) : (
        <div className="sos-incident-list">
          {incidents.map((incident) => {
            const isActive = ACTIVE_SOS_STATUSES.includes(incident.status);
            return (
              <article className={`sos-incident-card${isActive ? " is-active" : ""}`} key={incident.id}>
                <div className="sos-incident-heading">
                  <div>
                    <strong>{incident.ownerName} · {incident.mountainName}</strong>
                    <span>{formatIncidentDate(incident.createdAt)} · {SOS_CATEGORY_LABELS[incident.category]}</span>
                  </div>
                  <span className={`sos-status sos-status-${incident.status}`}>
                    {SOS_STATUS_LABELS[incident.status]}
                  </span>
                </div>
                {incident.description && <p>{incident.description}</p>}
                <div className="sos-contact-row">
                  {incident.emergencyContactName && (
                    <span>
                      Kontak darurat: {incident.emergencyContactName}{" "}
                      {incident.emergencyContactPhone && (
                        <a href={`tel:${incident.emergencyContactPhone}`}>{incident.emergencyContactPhone}</a>
                      )}
                    </span>
                  )}
                  {incident.ownerPhone && <a href={`tel:${incident.ownerPhone}`}>Telepon pendaki</a>}
                </div>
                {incident.location ? (
                  <a
                    className="sos-map-link"
                    href={`https://www.google.com/maps?q=${incident.location.latitude},${incident.location.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Buka lokasi GPS ({incident.location.latitude.toFixed(5)}, {incident.location.longitude.toFixed(5)})
                    {typeof incident.location.accuracy === "number" && ` · akurasi ±${Math.round(incident.location.accuracy)} m`}
                  </a>
                ) : (
                  <p className="sos-location-missing">Lokasi GPS tidak tersedia. Hubungi pendaki/kontak darurat.</p>
                )}
                {incident.history.length > 0 && (
                  <div className="sos-history">
                    {incident.history.map((entry, index) => (
                      <div key={`${incident.id}-${entry.at}-${index}`}>
                        <strong>{SOS_STATUS_LABELS[entry.status as SosStatus] ?? entry.status}</strong>
                        <span>{entry.changedByName} · {formatIncidentDate(entry.at)}</span>
                        {entry.note && <small>{entry.note}</small>}
                      </div>
                    ))}
                  </div>
                )}
                {isActive && (
                  <div className="sos-manager-actions">
                    <label className="form-field">Catatan tindakan <span>(opsional)</span>
                      <input
                        maxLength={500}
                        value={notes[incident.id] ?? ""}
                        onChange={(event) => setNotes((current) => ({
                          ...current,
                          [incident.id]: event.target.value,
                        }))}
                      />
                    </label>
                    <div className="operation-actions">
                      {incident.status === "open" && (
                        <>
                          <button
                            className="button button-primary"
                            type="button"
                            disabled={Boolean(updatingId)}
                            onClick={() => void updateIncident(incident, "acknowledge")}
                          >
                            Akui laporan
                          </button>
                          <button
                            className="button button-secondary"
                            type="button"
                            disabled={Boolean(updatingId)}
                            onClick={() => void updateIncident(incident, "false_alarm")}
                          >
                            Tandai tidak valid
                          </button>
                        </>
                      )}
                      {incident.status === "acknowledged" && (
                        <>
                          <button
                            className="button button-primary"
                            type="button"
                            disabled={Boolean(updatingId)}
                            onClick={() => void updateIncident(incident, "dispatch")}
                          >
                            Tim bantuan bergerak
                          </button>
                          <button
                            className="button button-secondary"
                            type="button"
                            disabled={Boolean(updatingId)}
                            onClick={() => void updateIncident(incident, "false_alarm")}
                          >
                            Tandai tidak valid
                          </button>
                        </>
                      )}
                      {incident.status === "dispatched" && (
                        <button
                          className="button button-primary"
                          type="button"
                          disabled={Boolean(updatingId)}
                          onClick={() => void updateIncident(incident, "resolve")}
                        >
                          Tandai selesai
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
