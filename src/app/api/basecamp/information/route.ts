import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionUser } from "@/lib/auth/session";
import { getAssignedBasecampId, hasPermission } from "@/lib/auth/roles";
import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";

type InformationType = "mountain" | "announcement";
type InformationBody = {
  type?: unknown;
  id?: unknown;
  title?: unknown;
  location?: unknown;
  elevation?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  status?: unknown;
  quota?: unknown;
  content?: unknown;
  visibility?: unknown;
};

async function getManager() {
  const user = await getSessionUser();
  if (!user) return { response: NextResponse.json({ error: "Silakan masuk." }, { status: 401 }) };
  if (!hasPermission(user, "information:write")) {
    return { response: NextResponse.json({ error: "Akses pengelolaan informasi ditolak." }, { status: 403 }) };
  }
  const basecampId = getAssignedBasecampId(user);
  if (!basecampId && user.role !== "admin" && user.role !== "superadmin") {
    return { response: NextResponse.json({ error: "Akun belum ditautkan ke Basecamp." }, { status: 409 }) };
  }
  return { user, basecampId };
}

function readType(value: unknown): value is InformationType {
  return value === "mountain" || value === "announcement";
}

function parseData(body: InformationBody, type: InformationType) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const visibility = body.visibility === "draft" ? "draft" : body.visibility === "public" ? "public" : null;
  if (
    title.length < 2 ||
    title.length > 120 ||
    !visibility ||
    content.length > 2000
  ) return null;

  if (type === "announcement") {
    if (content.length < 5) return null;
    return { title, body: content, visibility };
  }

  const location = typeof body.location === "string" ? body.location.trim() : "";
  const elevation = typeof body.elevation === "string" ? body.elevation.trim() : "";
  const latitude = body.latitude === "" || body.latitude == null ? null : body.latitude;
  const longitude = body.longitude === "" || body.longitude == null ? null : body.longitude;
  const status = typeof body.status === "string" ? body.status.trim() : "";
  const quota = body.quota;
  if (
    location.length > 120 ||
    elevation.length > 40 ||
    ((latitude === null) !== (longitude === null)) ||
    (latitude !== null &&
      (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
    (longitude !== null &&
      (typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) ||
    status.length < 2 ||
    status.length > 80 ||
    (quota !== undefined && (!Number.isSafeInteger(quota) || (quota as number) < 0)) ||
    (content.length === 0)
  ) return null;
  return {
    name: title,
    location,
    elevation,
    status,
    quota: quota ?? null,
    latitude,
    longitude,
    description: content,
    visibility,
  };
}

export async function GET() {
  const access = await getManager();
  if (access.response) return access.response;
  try {
    const firestore = getFirebaseAdminFirestore();
    const basecampRef = access.basecampId
      ? firestore.collection("basecamps").doc(access.basecampId)
      : null;
    const [mountains, announcements] = await Promise.all([
      basecampRef
        ? basecampRef.collection("mountains").get()
        : firestore.collection("mountains").get(),
      basecampRef
        ? basecampRef.collection("announcements").get()
        : firestore.collection("announcements").get(),
    ]);
    const mapDocs = (snapshot: FirebaseFirestore.QuerySnapshot) =>
      snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return NextResponse.json({
      mountains: mapDocs(mountains),
      announcements: mapDocs(announcements),
    });
  } catch (error) {
    console.error("Could not load Basecamp information:", error);
    return NextResponse.json({ error: "Informasi Basecamp belum dapat dimuat." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const access = await getManager();
  if (access.response) return access.response;
  let body: InformationBody;
  try {
    body = (await request.json()) as InformationBody;
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }
  if (!readType(body.type)) {
    return NextResponse.json({ error: "Jenis informasi tidak valid." }, { status: 400 });
  }
  const data = parseData(body, body.type);
  if (!data) {
    return NextResponse.json({ error: "Periksa kembali informasi yang dimasukkan." }, { status: 400 });
  }
  if (!access.basecampId) {
    return NextResponse.json({ error: "Pilih atau tautkan Basecamp sebelum menambah informasi." }, { status: 409 });
  }
  try {
    const firestore = getFirebaseAdminFirestore();
    const basecampRef = firestore.collection("basecamps").doc(access.basecampId);
    const basecamp = await basecampRef.get();
    if (!basecamp.exists) {
      return NextResponse.json({ error: "Basecamp tidak ditemukan." }, { status: 404 });
    }
    const basecampName = typeof basecamp.get("name") === "string" ? basecamp.get("name") : "Basecamp";
    const documentRef = basecampRef
      .collection(body.type === "mountain" ? "mountains" : "announcements")
      .doc();
    const dataToWrite = {
      ...data,
      basecampId: access.basecampId,
      ...(body.type === "announcement" ? { basecampName } : {}),
      createdBy: access.user!.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    const batch = firestore.batch();
    batch.set(documentRef, dataToWrite);
    batch.set(firestore.collection(body.type === "mountain" ? "mountains" : "announcements").doc(documentRef.id), dataToWrite);
    await batch.commit();
    return NextResponse.json({ ok: true, id: documentRef.id }, { status: 201 });
  } catch (error) {
    console.error("Could not create Basecamp information:", error);
    return NextResponse.json({ error: "Informasi belum dapat disimpan." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const access = await getManager();
  if (access.response) return access.response;
  let body: InformationBody;
  try {
    body = (await request.json()) as InformationBody;
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }
  if (!readType(body.type) || typeof body.id !== "string" || !body.id.trim()) {
    return NextResponse.json({ error: "Jenis informasi atau ID tidak valid." }, { status: 400 });
  }
  const data = parseData(body, body.type);
  if (!data) {
    return NextResponse.json({ error: "Periksa kembali informasi yang dimasukkan." }, { status: 400 });
  }
  if (!access.basecampId) {
    return NextResponse.json({ error: "Akun ini belum ditautkan ke Basecamp." }, { status: 409 });
  }
  try {
    const firestore = getFirebaseAdminFirestore();
    const collectionName = body.type === "mountain" ? "mountains" : "announcements";
    const nestedRef = firestore
      .collection("basecamps")
      .doc(access.basecampId)
      .collection(collectionName)
      .doc(body.id);
    const publicRef = firestore.collection(collectionName).doc(body.id);
    const update = { ...data, updatedAt: FieldValue.serverTimestamp() };
    await firestore.runTransaction(async (transaction) => {
      const [current, publicDocument] = await Promise.all([
        transaction.get(nestedRef),
        transaction.get(publicRef),
      ]);
      if (!current.exists || !publicDocument.exists) throw new Error("INFORMATION_NOT_FOUND");
      transaction.update(nestedRef, update);
      transaction.update(publicRef, update);
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "INFORMATION_NOT_FOUND") {
      return NextResponse.json({ error: "Informasi tidak ditemukan." }, { status: 404 });
    }
    console.error("Could not update Basecamp information:", error);
    return NextResponse.json({ error: "Informasi belum dapat diperbarui." }, { status: 500 });
  }
}
