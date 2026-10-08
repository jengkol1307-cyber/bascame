import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getRequestUser } from "@/lib/auth/session";
import {
  getAssignedBasecampId,
  getUserRole,
  hasPermission,
} from "@/lib/auth/roles";
import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";
import {
  getLiveSosIncidents,
  syncSosIncidentToRealtimeDatabase,
  type SosLiveIncident,
} from "@/lib/firebase/sos-live";

const SOS_CATEGORIES = ["medical", "injury", "lost", "other"] as const;
const ACTIVE_STATUSES = ["open", "acknowledged", "dispatched"];

type SosLocation = {
  latitude: number;
  longitude: number;
  accuracy?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLocation(value: unknown): SosLocation | null {
  if (!isRecord(value)) return null;
  const { latitude, longitude, accuracy } = value;
  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    (accuracy !== undefined &&
      (typeof accuracy !== "number" || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100_000))
  ) {
    return null;
  }
  return { latitude, longitude, ...(typeof accuracy === "number" ? { accuracy } : {}) };
}

function timestampToIso(value: unknown) {
  if (
    isRecord(value) &&
    typeof value.toDate === "function"
  ) {
    const date = (value.toDate as () => Date)();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null;
}

function serializeIncident(
  document: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot,
): SosLiveIncident | null {
  const data = document.data();
  if (!data) return null;
  const history = Array.isArray(data.history)
    ? data.history.filter(isRecord).map((entry) => ({
        status: typeof entry.status === "string" ? entry.status : "",
        changedByName: typeof entry.changedByName === "string" ? entry.changedByName : "Petugas",
        note: typeof entry.note === "string" ? entry.note : "",
        at: typeof entry.at === "string" ? entry.at : "",
      }))
    : [];
  return {
    id: document.id,
    registrationId: typeof data.registrationId === "string" ? data.registrationId : "",
    ownerName: typeof data.ownerName === "string" ? data.ownerName : "Pendaki",
    ownerPhone: typeof data.ownerPhone === "string" ? data.ownerPhone : "",
    emergencyContactName: typeof data.emergencyContactName === "string" ? data.emergencyContactName : "",
    emergencyContactPhone: typeof data.emergencyContactPhone === "string" ? data.emergencyContactPhone : "",
    mountainName: typeof data.mountainName === "string" ? data.mountainName : "Gunung",
    basecampId: typeof data.basecampId === "string" ? data.basecampId : "",
    category: typeof data.category === "string" ? data.category : "other",
    description: typeof data.description === "string" ? data.description : "",
    status: typeof data.status === "string" ? data.status : "open",
    location: parseLocation(data.location),
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
    history,
  };
}

function userDisplayName(user: Awaited<ReturnType<typeof getRequestUser>>) {
  if (!user) return "Pengguna";
  return typeof user.name === "string" && user.name.trim()
    ? user.name.trim()
    : typeof user.username === "string" && user.username.trim()
      ? user.username.trim()
      : typeof user.email === "string"
        ? user.email
        : "Pengguna";
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });

  const role = getUserRole(user);
  if (role !== "user" && !hasPermission(user, "sos:manage")) {
    return NextResponse.json({ error: "Akses ditolak." }, { status: 403 });
  }
  const basecampId = getAssignedBasecampId(user);
  if (
    role !== "user" &&
    role !== "admin" &&
    role !== "superadmin" &&
    !basecampId
  ) {
    return NextResponse.json({ error: "Akun belum ditautkan ke Basecamp." }, { status: 409 });
  }
  const liveScope = role === "user"
    ? { kind: "user" as const, uid: user.uid }
    : role === "admin" || role === "superadmin"
      ? { kind: "admin" as const }
      : { kind: "basecamp" as const, basecampId: basecampId ?? "" };

  try {
    if (new URL(request.url).searchParams.get("active") === "1") {
      const incidents = (await getLiveSosIncidents(liveScope))
        .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
      return NextResponse.json({ incidents }, { headers: { "Cache-Control": "no-store" } });
    }

    const firestore = getFirebaseAdminFirestore();
    let snapshot: FirebaseFirestore.QuerySnapshot;
    if (role === "user") {
      snapshot = await firestore
        .collection("sosIncidents")
        .where("ownerUid", "==", user.uid)
        .limit(50)
        .get();
    } else {
      snapshot =
        basecampId && role !== "admin" && role !== "superadmin"
          ? await firestore
              .collection("sosIncidents")
              .where("basecampId", "==", basecampId)
              .limit(100)
              .get()
          : await firestore.collection("sosIncidents").limit(100).get();
    }

    const archivedIncidents = snapshot.docs
      .map(serializeIncident)
      .filter((incident): incident is SosLiveIncident => incident !== null);
    let liveIncidents: SosLiveIncident[] = [];
    let realtimeWarning: string | undefined;
    try {
      liveIncidents = await getLiveSosIncidents(liveScope);
    } catch (error) {
      console.error("Could not load live SOS incidents from Realtime Database:", error);
      realtimeWarning = "Pembaruan cepat SOS tidak tersedia; data arsip tetap ditampilkan.";
    }
    const byId = new Map(archivedIncidents.map((incident) => [incident.id, incident]));
    liveIncidents.forEach((incident) => byId.set(incident.id, incident));
    const mergedIncidents = [...byId.values()]
      .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
    return NextResponse.json(
      { incidents: mergedIncidents, ...(realtimeWarning ? { warning: realtimeWarning } : {}) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Could not load SOS incidents:", error);
    return NextResponse.json({ error: "Data SOS belum dapat dimuat." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  if (getUserRole(user) !== "user") {
    return NextResponse.json({ error: "Hanya akun pendaki yang dapat mengirim SOS." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Permintaan SOS tidak valid." }, { status: 400 });
  }
  if (
    !isRecord(body) ||
    typeof body.registrationId !== "string" ||
    !body.registrationId.trim() ||
    body.registrationId.length > 128 ||
    typeof body.category !== "string" ||
    !SOS_CATEGORIES.includes(body.category as (typeof SOS_CATEGORIES)[number]) ||
    (body.clientRequestId !== undefined &&
      (typeof body.clientRequestId !== "string" ||
        !/^[A-Za-z0-9_-]{8,80}$/.test(body.clientRequestId))) ||
    (body.description !== undefined &&
      (typeof body.description !== "string" || body.description.trim().length > 1000))
  ) {
    return NextResponse.json({ error: "Periksa kembali data SOS." }, { status: 400 });
  }
  const registrationId = body.registrationId.trim();
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const location = body.location === undefined ? null : parseLocation(body.location);
  if (body.location !== undefined && !location) {
    return NextResponse.json({ error: "Koordinat lokasi tidak valid." }, { status: 400 });
  }

  try {
    const firestore = getFirebaseAdminFirestore();
    const registrationRef = firestore.collection("registrations").doc(registrationId);
    const clientRequestId = typeof body.clientRequestId === "string" ? body.clientRequestId : null;
    const incidentId = clientRequestId
      ? `sos_${createHash("sha256").update(`${registrationId}:${clientRequestId}`).digest("hex")}`
      : firestore.collection("sosIncidents").doc().id;
    const incidentRef = firestore.collection("sosIncidents").doc(incidentId);
    const result = await firestore.runTransaction(async (transaction) => {
      const [registrationSnapshot, existingIncident] = await Promise.all([
        transaction.get(registrationRef),
        transaction.get(incidentRef),
      ]);
      if (existingIncident.exists) {
        if (existingIncident.get("ownerUid") !== user.uid) {
          throw new Error("SOS_REGISTRATION_NOT_FOUND");
        }
        return { id: incidentRef.id };
      }
      if (
        !registrationSnapshot.exists ||
        registrationSnapshot.get("ownerUid") !== user.uid
      ) {
        throw new Error("SOS_REGISTRATION_NOT_FOUND");
      }
      const registration = registrationSnapshot.data();
      if (registration?.status !== "checked_in") {
        throw new Error("SOS_TRIP_NOT_ACTIVE");
      }
      const basecampId = typeof registration.basecampId === "string" ? registration.basecampId : "";
      if (!basecampId) throw new Error("SOS_BASECAMP_UNAVAILABLE");

      const activeIncidentId = registration.activeSosIncidentId;
      const activeIncident = typeof activeIncidentId === "string"
        ? await transaction.get(firestore.collection("sosIncidents").doc(activeIncidentId))
        : null;
      const hasActiveIncident = activeIncident?.exists &&
        ACTIVE_STATUSES.includes(String(activeIncident.get("status")));
      const previousIncidents = hasActiveIncident
        ? null
        : await transaction.get(
            firestore.collection("sosIncidents").where("registrationId", "==", registrationId).limit(50),
          );
      if (
        hasActiveIncident ||
        previousIncidents?.docs.some((document) => ACTIVE_STATUSES.includes(String(document.get("status"))))
      ) {
        throw new Error("SOS_ALREADY_ACTIVE");
      }

      const now = new Date().toISOString();
      const displayName = userDisplayName(user);
      transaction.create(incidentRef, {
        registrationId,
        ownerUid: user.uid,
        ownerName: typeof registration.ownerName === "string" ? registration.ownerName : displayName,
        ownerPhone: typeof user.phoneNumber === "string" ? user.phoneNumber : "",
        emergencyContactName: typeof registration.emergencyContactName === "string"
          ? registration.emergencyContactName
          : "",
        emergencyContactPhone: typeof registration.emergencyContactPhone === "string"
          ? registration.emergencyContactPhone
          : "",
        mountainId: typeof registration.mountainId === "string" ? registration.mountainId : "",
        mountainName: typeof registration.mountainName === "string" ? registration.mountainName : "Gunung",
        basecampId,
        category: body.category,
        description,
        status: "open",
        ...(location ? { location } : {}),
        ...(location ? { locationUpdatedAt: FieldValue.serverTimestamp() } : {}),
        history: [{ status: "open", changedBy: user.uid, changedByName: displayName, note: "SOS dikirim", at: now }],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(registrationRef, { activeSosIncidentId: incidentRef.id });
      return { id: incidentRef.id };
    });
    try {
      await syncSosIncidentToRealtimeDatabase(result.id);
    } catch (error) {
      console.error("SOS was archived but could not be published to Realtime Database:", error);
      return NextResponse.json(
        { error: "SOS sudah tercatat, tetapi notifikasi cepat Basecamp belum tersambung. Hubungi Basecamp melalui telepon." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "SOS_REGISTRATION_NOT_FOUND") {
        return NextResponse.json({ error: "Data pendakian tidak ditemukan." }, { status: 404 });
      }
      if (error.message === "SOS_TRIP_NOT_ACTIVE") {
        return NextResponse.json({ error: "SOS hanya dapat dikirim dari pendakian yang sudah check-in." }, { status: 409 });
      }
      if (error.message === "SOS_BASECAMP_UNAVAILABLE") {
        return NextResponse.json({ error: "Pendakian belum terhubung ke Basecamp. Hubungi Basecamp melalui telepon." }, { status: 409 });
      }
      if (error.message === "SOS_ALREADY_ACTIVE") {
        return NextResponse.json({ error: "Masih ada laporan SOS aktif untuk pendakian ini." }, { status: 409 });
      }
    }
    console.error("Could not create SOS incident:", error);
    return NextResponse.json({ error: "SOS belum dapat dikirim. Hubungi Basecamp melalui telepon." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Permintaan SOS tidak valid." }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.incidentId !== "string" || !body.incidentId.trim()) {
    return NextResponse.json({ error: "ID laporan SOS tidak valid." }, { status: 400 });
  }

  const operation = body.operation;
  const isLocationUpdate = operation === "location";
  const isStaffUpdate = operation === "acknowledge" ||
    operation === "dispatch" ||
    operation === "resolve" ||
    operation === "false_alarm";
  if (!isLocationUpdate && !isStaffUpdate) {
    return NextResponse.json({ error: "Pilih tindakan SOS yang valid." }, { status: 400 });
  }
  if (isLocationUpdate && getUserRole(user) !== "user") {
    return NextResponse.json({ error: "Akses pembaruan lokasi ditolak." }, { status: 403 });
  }
  if (isStaffUpdate && !hasPermission(user, "sos:manage")) {
    return NextResponse.json({ error: "Akses pengelolaan SOS ditolak." }, { status: 403 });
  }

  const location = isLocationUpdate ? parseLocation(body.location) : null;
  if (isLocationUpdate && !location) {
    return NextResponse.json({ error: "Koordinat lokasi tidak valid." }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > 500 || (body.note !== undefined && typeof body.note !== "string")) {
    return NextResponse.json({ error: "Catatan maksimal 500 karakter." }, { status: 400 });
  }

  const role = getUserRole(user);
  const basecampId = getAssignedBasecampId(user);
  if (
    isStaffUpdate &&
    role !== "admin" &&
    role !== "superadmin" &&
    !basecampId
  ) {
    return NextResponse.json({ error: "Akun belum ditautkan ke Basecamp." }, { status: 409 });
  }

  try {
    const firestore = getFirebaseAdminFirestore();
    const incidentRef = firestore.collection("sosIncidents").doc(body.incidentId.trim());
    await firestore.runTransaction(async (transaction) => {
      const incident = await transaction.get(incidentRef);
      if (!incident.exists) throw new Error("SOS_INCIDENT_NOT_FOUND");
      if (isLocationUpdate) {
        if (incident.get("ownerUid") !== user.uid) throw new Error("SOS_ACCESS_DENIED");
        if (!ACTIVE_STATUSES.includes(incident.get("status"))) throw new Error("SOS_INCIDENT_CLOSED");
        transaction.update(incidentRef, {
          location,
          locationUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return;
      }

      const currentStatus = incident.get("status");
      const incidentBasecampId = incident.get("basecampId");
      if (
        role !== "admin" &&
        role !== "superadmin" &&
        incidentBasecampId !== basecampId
      ) {
        throw new Error("SOS_ACCESS_DENIED");
      }

      const transitions: Record<string, string> = {
        acknowledge: "acknowledged",
        dispatch: "dispatched",
        resolve: "resolved",
        false_alarm: "false_alarm",
      };
      const nextStatus = transitions[String(operation)];
      const allowed =
        (operation === "acknowledge" && currentStatus === "open") ||
        (operation === "dispatch" && currentStatus === "acknowledged") ||
        (operation === "resolve" && currentStatus === "dispatched") ||
        (operation === "false_alarm" && ["open", "acknowledged"].includes(String(currentStatus)));
      if (!allowed) throw new Error("SOS_INVALID_TRANSITION");

      const registrationRef = firestore.collection("registrations").doc(
        typeof incident.get("registrationId") === "string" ? incident.get("registrationId") : "",
      );
      const registration = await transaction.get(registrationRef);
      const displayName = userDisplayName(user);
      const now = new Date().toISOString();
      transaction.update(incidentRef, {
        status: nextStatus,
        handledBy: user.uid,
        handledByName: displayName,
        ...(note ? { lastNote: note } : {}),
        history: FieldValue.arrayUnion({
          status: nextStatus,
          changedBy: user.uid,
          changedByName: displayName,
          note,
          at: now,
        }),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (
        (operation === "resolve" || operation === "false_alarm") &&
        registration.exists &&
        registration.get("activeSosIncidentId") === incidentRef.id
      ) {
        transaction.update(registrationRef, {
          activeSosIncidentId: FieldValue.delete(),
        });
      }
    });
    await syncSosIncidentToRealtimeDatabase(body.incidentId.trim());
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "SOS_INCIDENT_NOT_FOUND") {
        return NextResponse.json({ error: "Laporan SOS tidak ditemukan." }, { status: 404 });
      }
      if (error.message === "SOS_ACCESS_DENIED") {
        return NextResponse.json({ error: "Anda tidak memiliki akses ke laporan ini." }, { status: 403 });
      }
      if (error.message === "SOS_INCIDENT_CLOSED") {
        return NextResponse.json({ error: "Lokasi tidak dapat diperbarui karena laporan sudah selesai." }, { status: 409 });
      }
      if (error.message === "SOS_INVALID_TRANSITION") {
        return NextResponse.json({ error: "Status SOS sudah berubah. Muat ulang daftar laporan." }, { status: 409 });
      }
    }
    console.error("Could not update SOS incident:", error);
    return NextResponse.json({ error: "Laporan SOS belum dapat diperbarui." }, { status: 500 });
  }
}
