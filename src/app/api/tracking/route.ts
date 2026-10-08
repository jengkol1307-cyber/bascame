import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAssignedBasecampId, getUserRole, hasPermission } from "@/lib/auth/roles";
import { getRequestUser } from "@/lib/auth/session";
import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";

const MAX_BATCH_SIZE = 100;
const MAX_ACCURACY_METERS = 100_000;
const MAX_CAPTURE_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_OFFSET_MS = 5 * 60 * 1000;
const MAX_STAFF_HISTORY = 5000;

type LocationPointInput = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  capturedAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePoint(value: unknown, now: number): LocationPointInput | null {
  if (!isRecord(value)) return null;
  const { latitude, longitude, accuracy, capturedAt } = value;
  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    typeof capturedAt !== "number" ||
    !Number.isSafeInteger(capturedAt) ||
    capturedAt < now - MAX_CAPTURE_AGE_MS ||
    capturedAt > now + MAX_FUTURE_OFFSET_MS ||
    (accuracy !== undefined &&
      (typeof accuracy !== "number" ||
        !Number.isFinite(accuracy) ||
        accuracy < 0 ||
        accuracy > MAX_ACCURACY_METERS))
  ) {
    return null;
  }
  return {
    latitude,
    longitude,
    capturedAt,
    ...(typeof accuracy === "number" ? { accuracy } : {}),
  };
}

function toIso(value: unknown) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return null;
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Silakan masuk kembali di aplikasi." }, { status: 401 });
  if (getUserRole(user) !== "user") {
    return NextResponse.json({ error: "Hanya akun pendaki yang dapat mengirim titik GPS." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Data lokasi tidak valid." }, { status: 400 });
  }
  if (
    !isRecord(body) ||
    typeof body.registrationId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(body.registrationId) ||
    !Array.isArray(body.points) ||
    body.points.length < 1 ||
    body.points.length > MAX_BATCH_SIZE
  ) {
    return NextResponse.json({ error: `Kirim 1–${MAX_BATCH_SIZE} titik GPS untuk satu pendakian.` }, { status: 400 });
  }

  const now = Date.now();
  const points = body.points.map((point) => parsePoint(point, now));
  if (points.some((point) => point === null)) {
    return NextResponse.json({ error: "Salah satu titik GPS memiliki koordinat, akurasi, atau waktu yang tidak valid." }, { status: 400 });
  }
  const validPoints = points as LocationPointInput[];
  if (new Set(validPoints.map((point) => point.capturedAt)).size !== validPoints.length) {
    return NextResponse.json({ error: "Waktu titik GPS dalam satu batch harus unik." }, { status: 400 });
  }

  try {
    const firestore = getFirebaseAdminFirestore();
    const registrationRef = firestore.collection("registrations").doc(body.registrationId);
    const pointsCollection = firestore.collection("trackingPoints");
    await firestore.runTransaction(async (transaction) => {
      const registration = await transaction.get(registrationRef);
      if (!registration.exists || registration.get("ownerUid") !== user.uid) {
        throw new Error("TRACKING_REGISTRATION_NOT_FOUND");
      }
      if (registration.get("status") !== "checked_in") {
        throw new Error("TRACKING_TRIP_NOT_ACTIVE");
      }
      const basecampId = registration.get("basecampId");
      if (typeof basecampId !== "string" || !basecampId) {
        throw new Error("TRACKING_BASECAMP_UNAVAILABLE");
      }

      for (const point of validPoints) {
        const pointRef = pointsCollection.doc(`${body.registrationId}_${point.capturedAt}`);
        transaction.set(pointRef, {
          registrationId: body.registrationId,
          ownerUid: user.uid,
          ownerName: typeof registration.get("ownerName") === "string"
            ? registration.get("ownerName")
            : "Pendaki",
          basecampId,
          mountainId: typeof registration.get("mountainId") === "string"
            ? registration.get("mountainId")
            : "",
          mountainName: typeof registration.get("mountainName") === "string"
            ? registration.get("mountainName")
            : "Gunung",
          startDate: typeof registration.get("startDate") === "string"
            ? registration.get("startDate")
            : "",
          endDate: typeof registration.get("endDate") === "string"
            ? registration.get("endDate")
            : "",
          latitude: point.latitude,
          longitude: point.longitude,
          ...(typeof point.accuracy === "number" ? { accuracy: point.accuracy } : {}),
          capturedAt: Timestamp.fromMillis(point.capturedAt),
          receivedAt: FieldValue.serverTimestamp(),
        });
      }
    });
    return NextResponse.json({ ok: true, accepted: validPoints.length });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "TRACKING_REGISTRATION_NOT_FOUND") {
        return NextResponse.json({ error: "Pendakian tidak ditemukan untuk akun ini." }, { status: 404 });
      }
      if (error.message === "TRACKING_TRIP_NOT_ACTIVE") {
        return NextResponse.json({ error: "Pelacakan hanya menerima titik saat pendakian berstatus check-in." }, { status: 409 });
      }
      if (error.message === "TRACKING_BASECAMP_UNAVAILABLE") {
        return NextResponse.json({ error: "Pendakian belum terhubung ke Basecamp." }, { status: 409 });
      }
    }
    console.error("Could not save hiker location points:", error);
    return NextResponse.json({ error: "Titik GPS belum dapat disimpan." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });

  const role = getUserRole(user);
  const registrationId = new URL(request.url).searchParams.get("registrationId");
  if (registrationId !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(registrationId)) {
    return NextResponse.json({ error: "ID pendakian tidak valid." }, { status: 400 });
  }
  if (role === "user" && !registrationId) {
    return NextResponse.json({ error: "Pilih pendakian untuk melihat histori lokasi." }, { status: 400 });
  }
  if (
    role !== "user" &&
    !hasPermission(user, "manifest:read")
  ) {
    return NextResponse.json({ error: "Akses histori lokasi ditolak." }, { status: 403 });
  }

  try {
    const firestore = getFirebaseAdminFirestore();
    let basecampId: string | null = null;
    if (role !== "user" && role !== "admin" && role !== "superadmin") {
      basecampId = getAssignedBasecampId(user);
      if (!basecampId) {
        return NextResponse.json({ error: "Akun belum ditautkan ke Basecamp." }, { status: 409 });
      }
    }

    if (registrationId) {
      const registration = await firestore.collection("registrations").doc(registrationId).get();
      if (!registration.exists) {
        return NextResponse.json({ error: "Pendakian tidak ditemukan." }, { status: 404 });
      }
      if (role === "user") {
        if (registration.get("ownerUid") !== user.uid) {
          return NextResponse.json({ error: "Akses histori pendakian ditolak." }, { status: 403 });
        }
      } else if (
        basecampId &&
        registration.get("basecampId") !== basecampId
      ) {
        return NextResponse.json({ error: "Pendakian berada di luar cakupan Basecamp Anda." }, { status: 403 });
      }
    }

    let query: FirebaseFirestore.Query = firestore.collection("trackingPoints");
    if (role === "user") query = query.where("ownerUid", "==", user.uid);
    else if (basecampId) query = query.where("basecampId", "==", basecampId);
    if (registrationId) query = query.where("registrationId", "==", registrationId);
    const limit = role === "user" ? 1000 : MAX_STAFF_HISTORY;
    const snapshot = await query.orderBy("capturedAt", "desc").limit(limit + 1).get();
    const truncated = snapshot.size > limit;
    const points = snapshot.docs.slice(0, limit).map((document) => {
      const data = document.data();
      return {
        id: document.id,
        registrationId: typeof data.registrationId === "string" ? data.registrationId : "",
        ownerName: typeof data.ownerName === "string" ? data.ownerName : "Pendaki",
        mountainName: typeof data.mountainName === "string" ? data.mountainName : "Gunung",
        startDate: typeof data.startDate === "string" ? data.startDate : "",
        endDate: typeof data.endDate === "string" ? data.endDate : "",
        latitude: typeof data.latitude === "number" ? data.latitude : null,
        longitude: typeof data.longitude === "number" ? data.longitude : null,
        accuracy: typeof data.accuracy === "number" ? data.accuracy : null,
        capturedAt: toIso(data.capturedAt),
      };
    }).reverse();

    return NextResponse.json(
      { points, truncated },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Could not load hiker location history:", error);
    return NextResponse.json({ error: "Histori lokasi belum dapat dimuat." }, { status: 500 });
  }
}
