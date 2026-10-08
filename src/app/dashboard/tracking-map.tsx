"use client";

import { Map as MapLibreMap, NavigationControl, Popup, type GeoJSONSource } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

type TrackPoint = {
  id: string;
  registrationId: string;
  ownerName: string;
  mountainName: string;
  startDate: string;
  endDate: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  capturedAt: string | null;
};

type SosPoint = {
  id: string;
  registrationId: string;
  ownerName: string;
  mountainName: string;
  status: "open" | "acknowledged" | "dispatched" | "resolved" | "false_alarm";
  createdAt: string | null;
  location: { latitude: number; longitude: number; accuracy?: number } | null;
};

type FeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Geometry, GeoJSON.GeoJsonProperties>;

const EMPTY_COLLECTION: FeatureCollection = { type: "FeatureCollection", features: [] };

function asFeatureCollection(
  points: TrackPoint[],
  incidents: SosPoint[],
  selectedRegistration: string,
): { tracks: FeatureCollection; markers: FeatureCollection; sos: FeatureCollection } {
  const groups = new Map<string, TrackPoint[]>();
  for (const point of points) {
    if (
      typeof point.latitude !== "number" ||
      typeof point.longitude !== "number" ||
      (selectedRegistration && point.registrationId !== selectedRegistration)
    ) continue;
    const group = groups.get(point.registrationId) ?? [];
    group.push(point);
    groups.set(point.registrationId, group);
  }

  const trackFeatures: FeatureCollection["features"] = [];
  const markerFeatures: FeatureCollection["features"] = [];
  for (const [registrationId, route] of groups) {
    route.sort((left, right) =>
      (left.capturedAt ?? "").localeCompare(right.capturedAt ?? ""),
    );
    const first = route[0];
    const last = route[route.length - 1];
    const coordinates = route.map((point) => [point.longitude!, point.latitude!] as [number, number]);
    const ageMinutes = last.capturedAt
      ? (Date.now() - Date.parse(last.capturedAt)) / 60_000
      : Number.POSITIVE_INFINITY;
    if (coordinates.length > 1) {
      trackFeatures.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates },
        properties: {
          registrationId,
          ownerName: first.ownerName,
          mountainName: first.mountainName,
          isStale: ageMinutes > 90,
        },
      });
    }
    markerFeatures.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: coordinates[coordinates.length - 1] },
      properties: {
        registrationId,
        ownerName: first.ownerName,
        mountainName: first.mountainName,
        capturedAt: last.capturedAt ?? "",
        accuracy: last.accuracy ?? 0,
        isStale: ageMinutes > 90,
        pointCount: route.length,
      },
    });
  }

  const sosFeatures: FeatureCollection["features"] = incidents.flatMap((incident) => {
    if (!incident.location || (selectedRegistration && incident.registrationId !== selectedRegistration)) {
      return [];
    }
    return [{
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [incident.location.longitude, incident.location.latitude],
      },
      properties: {
        id: incident.id,
        ownerName: incident.ownerName,
        mountainName: incident.mountainName,
        status: incident.status,
        createdAt: incident.createdAt ?? "",
      },
    }];
  });

  return {
    tracks: { type: "FeatureCollection", features: trackFeatures },
    markers: { type: "FeatureCollection", features: markerFeatures },
    sos: { type: "FeatureCollection", features: sosFeatures },
  };
}

function localDateTime(value: string) {
  const time = new Date(value);
  return Number.isNaN(time.getTime())
    ? "Waktu tidak tersedia"
    : new Intl.DateTimeFormat("id-ID", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Asia/Jakarta",
      }).format(time);
}

export function TrackingMap() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [incidents, setIncidents] = useState<SosPoint[]>([]);
  const [selectedRegistration, setSelectedRegistration] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const apiKey = process.env.NEXT_PUBLIC_MAPTILER_API_KEY?.trim() ?? "";
  const { tracks, markers, sos } = useMemo(
    () => asFeatureCollection(points, incidents, selectedRegistration),
    [points, incidents, selectedRegistration],
  );

  async function loadTrackingData() {
    try {
      const [trackingResponse, sosResponse] = await Promise.all([
        fetch("/api/tracking", { cache: "no-store" }),
        fetch("/api/sos", { cache: "no-store" }),
      ]);
      const [trackingResult, sosResult] = await Promise.all([
        trackingResponse.json() as Promise<{
          points?: TrackPoint[];
          truncated?: boolean;
          error?: string;
        }>,
        sosResponse.json() as Promise<{ incidents?: SosPoint[]; error?: string }>,
      ]);
      if (!trackingResponse.ok) throw new Error(trackingResult.error ?? "Histori lokasi belum dapat dimuat.");
      if (!sosResponse.ok) throw new Error(sosResult.error ?? "Laporan SOS belum dapat dimuat.");
      setPoints(trackingResult.points ?? []);
      setIncidents(sosResult.incidents ?? []);
      setTruncated(trackingResult.truncated ?? false);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Data pelacakan belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    async function poll() {
      if (cancelled) return;
      await loadTrackingData();
      if (!cancelled) timer = window.setTimeout(() => void poll(), 30_000);
    }
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || !apiKey || mapRef.current) return;
    const map = new MapLibreMap({
      container: mapContainerRef.current,
      style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(apiKey)}`,
      center: [110.4, -7.3],
      zoom: 8,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl(), "top-right");
    map.on("load", () => {
      map.addSource("hiker-tracks", { type: "geojson", data: EMPTY_COLLECTION });
      map.addSource("hiker-locations", { type: "geojson", data: EMPTY_COLLECTION });
      map.addSource("sos-locations", { type: "geojson", data: EMPTY_COLLECTION });
      map.addLayer({
        id: "hiker-track-lines",
        type: "line",
        source: "hiker-tracks",
        paint: {
          "line-color": ["case", ["get", "isStale"], "#a38a64", "#277651"],
          "line-width": 4,
          "line-opacity": 0.82,
        },
      });
      map.addLayer({
        id: "hiker-location-points",
        type: "circle",
        source: "hiker-locations",
        paint: {
          "circle-radius": 7,
          "circle-color": ["case", ["get", "isStale"], "#cf8b30", "#277651"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.addLayer({
        id: "sos-location-points",
        type: "circle",
        source: "sos-locations",
        paint: {
          "circle-radius": 10,
          "circle-color": "#c54035",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.on("click", "hiker-location-points", (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
        const properties = feature.properties ?? {};
        const popupContent = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = String(properties.ownerName ?? "Pendaki");
        const location = document.createElement("div");
        location.textContent = String(properties.mountainName ?? "Gunung");
        const signal = document.createElement("div");
        signal.textContent = `Sinyal: ${localDateTime(String(properties.capturedAt ?? ""))}`;
        const count = document.createElement("div");
        count.textContent = `${Number(properties.pointCount ?? 0)} titik perjalanan`;
        popupContent.append(title, location, signal, count);
        new Popup()
          .setLngLat(coordinates)
          .setDOMContent(popupContent)
          .addTo(map);
      });
      map.on("click", "sos-location-points", (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
        const properties = feature.properties ?? {};
        const popupContent = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = `SOS · ${String(properties.ownerName ?? "Pendaki")}`;
        const location = document.createElement("div");
        location.textContent = String(properties.mountainName ?? "Gunung");
        const status = document.createElement("div");
        status.textContent = String(properties.status ?? "Laporan baru");
        const createdAt = document.createElement("div");
        createdAt.textContent = localDateTime(String(properties.createdAt ?? ""));
        popupContent.append(title, location, status, createdAt);
        new Popup()
          .setLngLat(coordinates)
          .setDOMContent(popupContent)
          .addTo(map);
      });
      map.on("mouseenter", "hiker-location-points", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "hiker-location-points", () => { map.getCanvas().style.cursor = ""; });
      map.on("mouseenter", "sos-location-points", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "sos-location-points", () => { map.getCanvas().style.cursor = ""; });
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [apiKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      (map.getSource("hiker-tracks") as GeoJSONSource | undefined)?.setData(tracks);
      (map.getSource("hiker-locations") as GeoJSONSource | undefined)?.setData(markers);
      (map.getSource("sos-locations") as GeoJSONSource | undefined)?.setData(sos);
    };
    if (map.isStyleLoaded()) update();
    else map.once("load", update);
  }, [tracks, markers, sos]);

  const registrationOptions = useMemo(() => {
    const choices = new Map<string, TrackPoint>();
    points.forEach((point) => choices.set(point.registrationId, point));
    return [...choices.values()].sort((left, right) =>
      `${left.mountainName} ${left.ownerName}`.localeCompare(`${right.mountainName} ${right.ownerName}`, "id"),
    );
  }, [points]);

  const activeSos = incidents.filter((incident) =>
    ["open", "acknowledged", "dispatched"].includes(incident.status),
  );

  return (
    <section className="dashboard-panel admin-operation-panel tracking-map-panel">
      <div className="staff-section-heading">
        <div>
          <span className="admin-kicker">POSISI & HISTORI PERJALANAN</span>
          <h2>Peta pelacakan pendaki</h2>
          <p>Sinyal diperbarui setiap 30 detik pada dashboard ini; rekaman pendaki mengikuti jadwal perangkat.</p>
        </div>
        <button className="button button-secondary" type="button" onClick={() => void loadTrackingData()}>
          Muat ulang
        </button>
      </div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {truncated && (
        <p className="sos-safety-note">
          Peta menampilkan 5.000 titik terbaru untuk Basecamp ini. Gunakan filter pendakian untuk melihat rute tertentu.
        </p>
      )}
      {activeSos.length > 0 && (
        <div className="tracking-active-alert" role="status">
          {activeSos.length} laporan SOS aktif · titik SOS tersedia ditandai merah pada peta.
        </div>
      )}
      <div className="tracking-map-toolbar">
        <label className="form-field">Filter pendakian
          <select
            value={selectedRegistration}
            onChange={(event) => setSelectedRegistration(event.target.value)}
          >
            <option value="">Semua pendaki</option>
            {registrationOptions.map((point) => (
              <option value={point.registrationId} key={point.registrationId}>
                {point.ownerName} · {point.mountainName} · {point.startDate}
              </option>
            ))}
          </select>
        </label>
        <span><i className="tracking-legend-line" /> Rute GPS</span>
        <span><i className="tracking-legend-dot" /> Sinyal terbaru</span>
        <span><i className="tracking-legend-sos" /> SOS aktif</span>
      </div>
      {apiKey ? (
        <div ref={mapContainerRef} className="tracking-map-canvas" aria-label="Peta histori dan posisi pendaki" />
      ) : (
        <div className="tracking-map-unconfigured">
          <strong>Kunci peta belum diatur.</strong>
          <span>
            Tambahkan <code>NEXT_PUBLIC_MAPTILER_API_KEY</code> ke environment Vercel dan lokal untuk
            menampilkan peta MapTiler.
          </span>
        </div>
      )}
      {loading && <p className="tracking-map-loading">Memuat histori GPS dan laporan SOS...</p>}
      {points.length === 0 && !loading && (
        <p className="tracking-map-empty">Belum ada sinyal lokasi. Sinyal akan muncul setelah APK mengirim titik GPS pendaki.</p>
      )}
    </section>
  );
}
