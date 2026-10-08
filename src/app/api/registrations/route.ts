import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import type { QuerySnapshot } from "firebase-admin/firestore";
import { getSessionUser } from "@/lib/auth/session";
import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";
import { getAssignedBasecampId, getUserRole, hasPermission } from "@/lib/auth/roles";

type CreateRegistration = {
  mountainId?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  groupSize?: unknown;
  emergencyContactName?: unknown;
  emergencyContactPhone?: unknown;
  notes?: unknown;
};

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });

  try {
    const role = getUserRole(user);
    const registrationsCollection = getFirebaseAdminFirestore().collection("registrations");
    let snapshot: QuerySnapshot;
    if (role === "user") {
      snapshot = await registrationsCollection.where("ownerUid", "==", user.uid).limit(100).get();
    } else if (
      hasPermission(user, "registrations:read") ||
      hasPermission(user, "manifest:read") ||
      hasPermission(user, "finance:read")
    ) {
      const basecampId = getAssignedBasecampId(user);
      if (!basecampId && role !== "admin" && role !== "superadmin") {
        return NextResponse.json({ error: "Akun belum ditautkan ke Basecamp." }, { status: 409 });
      }
      snapshot =
        basecampId && role !== "admin" && role !== "superadmin"
          ? await registrationsCollection.where("basecampId", "==", basecampId).limit(100).get()
          : await registrationsCollection.limit(100).get();
    } else {
      return NextResponse.json({ error: "Akses ditolak." }, { status: 403 });
    }
    const registrations = snapshot.docs
      .map((document) => {
        const data = document.data();
        return { id: document.id, data, createdAtMs: data.createdAt?.toMillis?.() ?? 0 };
      })
      .sort((a, b) => {
        return b.createdAtMs - a.createdAtMs;
      })
      .map(({ id, data }) => {
        if (role === "treasurer") {
          return {
            id,
            ownerName: data.ownerName,
            mountainName: data.mountainName,
            startDate: data.startDate,
            endDate: data.endDate,
            groupSize: data.groupSize,
            status: data.status,
          };
        }
        if (role !== "field_officer") return { id, ...data };
        return {
          id,
          ownerName: data.ownerName,
          mountainId: data.mountainId,
          mountainName: data.mountainName,
          startDate: data.startDate,
          endDate: data.endDate,
          groupSize: data.groupSize,
          status: data.status,
          ticketCode: data.ticketCode,
          checkedInAt: data.checkedInAt,
          checkedOutAt: data.checkedOutAt,
        };
      });
    return NextResponse.json({ registrations });
  } catch (error) {
    console.error("Could not load user registrations:", error);
    return NextResponse.json({ error: "Data pendakian belum dapat dimuat." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  if (getUserRole(user) !== "user") {
    return NextResponse.json({ error: "Akun staf tidak dapat membuat pendaftaran pendaki." }, { status: 403 });
  }
  if (typeof user.email !== "string") {
    return NextResponse.json({ error: "Profil akun belum lengkap." }, { status: 400 });
  }

  let body: CreateRegistration;
  try {
    body = (await request.json()) as CreateRegistration;
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  if (
    typeof body.mountainId !== "string" ||
    !body.mountainId.trim() ||
    typeof body.startDate !== "string" ||
    typeof body.endDate !== "string" ||
    !Number.isInteger(body.groupSize) ||
    typeof body.groupSize !== "number" ||
    body.groupSize < 1 ||
    body.groupSize > 20 ||
    typeof body.emergencyContactName !== "string" ||
    typeof body.emergencyContactPhone !== "string" ||
    (body.notes !== undefined && typeof body.notes !== "string")
  ) {
    return NextResponse.json({ error: "Periksa kembali data pendakian." }, { status: 400 });
  }

  const start = new Date(`${body.startDate}T00:00:00.000Z`);
  const end = new Date(`${body.endDate}T00:00:00.000Z`);
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start < now ||
    end < start ||
    end.getTime() - start.getTime() > 14 * 24 * 60 * 60 * 1000
  ) {
    return NextResponse.json({ error: "Rentang tanggal pendakian tidak valid." }, { status: 400 });
  }

  const emergencyContactName = body.emergencyContactName.trim();
  const emergencyContactPhone = body.emergencyContactPhone.trim();
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (
    emergencyContactName.length < 2 ||
    emergencyContactName.length > 80 ||
    emergencyContactPhone.length < 6 ||
    emergencyContactPhone.length > 32 ||
    notes.length > 500
  ) {
    return NextResponse.json({ error: "Data kontak darurat atau catatan tidak valid." }, { status: 400 });
  }

  try {
    const firestore = getFirebaseAdminFirestore();
    const mountain = await firestore.collection("mountains").doc(body.mountainId).get();
    if (!mountain.exists || mountain.get("visibility") !== "public") {
      return NextResponse.json({ error: "Gunung tidak tersedia untuk pendaftaran." }, { status: 404 });
    }

    const document = await firestore.collection("registrations").add({
      ownerUid: user.uid,
      ownerEmail: user.email,
      ownerName: user.name ?? user.username ?? user.email,
      mountainId: mountain.id,
      ...(typeof mountain.get("basecampId") === "string"
        ? { basecampId: mountain.get("basecampId") }
        : {}),
      mountainName: typeof mountain.get("name") === "string" ? mountain.get("name") : "Gunung",
      startDate: body.startDate,
      endDate: body.endDate,
      groupSize: body.groupSize,
      emergencyContactName,
      emergencyContactPhone,
      notes,
      status: "pending",
      ticketCode: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, registrationId: document.id }, { status: 201 });
  } catch (error) {
    console.error("Could not submit mountain registration:", error);
    return NextResponse.json({ error: "Pendaftaran belum dapat disimpan." }, { status: 500 });
  }
}
