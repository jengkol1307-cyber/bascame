import "server-only";
import { getFirebaseAdminFirestore, getFirebaseAdminRealtimeDatabase } from "./admin";

const ACTIVE_STATUSES = new Set(["open", "acknowledged", "dispatched"]);

type SosScope =
  | { kind: "admin" }
  | { kind: "basecamp"; basecampId: string }
  | { kind: "user"; uid: string };

export type SosLiveIncident = {
  id: string;
  registrationId: string;
  ownerName: string;
  ownerPhone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  mountainName: string;
  basecampId: string;
  category: string;
  description: string;
  status: string;
  location: { latitude: number; longitude: number; accuracy?: number } | null;
  createdAt: string | null;
  updatedAt: string | null;
  history: { status: string; changedByName: string; note: string; at: string }[];
};

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function parseLocation(value: unknown): SosLiveIncident["location"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const location = value as Record<string, unknown>;
  if (
    typeof location.latitude !== "number" ||
    !Number.isFinite(location.latitude) ||
    location.latitude < -90 ||
    location.latitude > 90 ||
    typeof location.longitude !== "number" ||
    !Number.isFinite(location.longitude) ||
    location.longitude < -180 ||
    location.longitude > 180
  ) {
    return null;
  }
  const accuracy = typeof location.accuracy === "number" &&
      Number.isFinite(location.accuracy) &&
      location.accuracy >= 0 &&
      location.accuracy <= 100_000
    ? location.accuracy
    : undefined;
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    ...(accuracy === undefined ? {} : { accuracy }),
  };
}

function timestampMillis(value: unknown): number | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "toMillis" in value &&
    typeof value.toMillis === "function"
  ) {
    return value.toMillis();
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  return null;
}

export async function syncSosIncidentToRealtimeDatabase(incidentId: string) {
  const firestore = getFirebaseAdminFirestore();
  const snapshot = await firestore.collection("sosIncidents").doc(incidentId).get();
  if (!snapshot.exists) return;

  const data = snapshot.data();
  if (!data) return;
  const ownerUid = asString(data.ownerUid);
  const basecampId = asString(data.basecampId);
  if (!ownerUid || !basecampId) {
    throw new Error(`SOS incident ${incidentId} is missing its owner or Basecamp scope.`);
  }

  const root = getFirebaseAdminRealtimeDatabase().ref();
  const paths = [
    `sosLive/admin/${incidentId}`,
    `sosLive/basecamps/${basecampId}/${incidentId}`,
    `sosLive/users/${ownerUid}/${incidentId}`,
  ];
  if (!ACTIVE_STATUSES.has(asString(data.status))) {
    await root.update(Object.fromEntries(paths.map((path) => [path, null])));
    return;
  }

  const createdAt = timestampMillis(data.createdAt);
  const updatedAt = timestampMillis(data.updatedAt);
  const locationUpdatedAt = timestampMillis(data.locationUpdatedAt);
  const incident = {
    id: incidentId,
    registrationId: asString(data.registrationId),
    ownerName: asString(data.ownerName, "Pendaki"),
    ownerPhone: asString(data.ownerPhone),
    emergencyContactName: asString(data.emergencyContactName),
    emergencyContactPhone: asString(data.emergencyContactPhone),
    mountainName: asString(data.mountainName, "Gunung"),
    basecampId,
    category: asString(data.category, "other"),
    description: asString(data.description),
    status: asString(data.status, "open"),
    location: data.location ?? null,
    ...(createdAt === null ? {} : { createdAt }),
    ...(updatedAt === null ? {} : { updatedAt }),
    ...(locationUpdatedAt === null ? {} : { locationUpdatedAt }),
    history: Array.isArray(data.history) ? data.history : [],
  };
  await root.update(Object.fromEntries(paths.map((path) => [path, incident])));
}

export async function getLiveSosIncidents(scope: SosScope) {
  const path = scope.kind === "admin"
    ? "sosLive/admin"
    : scope.kind === "basecamp"
      ? `sosLive/basecamps/${scope.basecampId}`
      : `sosLive/users/${scope.uid}`;
  const snapshot = await getFirebaseAdminRealtimeDatabase().ref(path).get();
  const records = snapshot.val();
  if (typeof records !== "object" || records === null || Array.isArray(records)) return [];

  return Object.entries(records).flatMap(([id, value]): SosLiveIncident[] => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    const data = value as Record<string, unknown>;
    const createdAt = typeof data.createdAt === "number"
      ? new Date(data.createdAt).toISOString()
      : null;
    const updatedAt = typeof data.updatedAt === "number"
      ? new Date(data.updatedAt).toISOString()
      : null;
    const history = Array.isArray(data.history)
      ? data.history.flatMap((entry): SosLiveIncident["history"] => {
          if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
          const item = entry as Record<string, unknown>;
          return [{
            status: asString(item.status),
            changedByName: asString(item.changedByName, "Petugas"),
            note: asString(item.note),
            at: asString(item.at),
          }];
        })
      : [];
    return [{
      id,
      registrationId: asString(data.registrationId),
      ownerName: asString(data.ownerName, "Pendaki"),
      ownerPhone: asString(data.ownerPhone),
      emergencyContactName: asString(data.emergencyContactName),
      emergencyContactPhone: asString(data.emergencyContactPhone),
      mountainName: asString(data.mountainName, "Gunung"),
      basecampId: asString(data.basecampId),
      category: asString(data.category, "other"),
      description: asString(data.description),
      status: asString(data.status, "open"),
      location: parseLocation(data.location),
      createdAt,
      updatedAt,
      history,
    }];
  });
}
