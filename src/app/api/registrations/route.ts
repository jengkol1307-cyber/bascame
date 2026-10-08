import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionUser } from "@/lib/auth/session";
import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";
import { getAssignedBasecampId, getUserRole, hasPermission } from "@/lib/auth/roles";
import {
  getCapacityLockRefs,
  isCapacityAvailable,
  isMountainOpenForRegistration,
  parseHikerRegistrationInput,
  readCapacityLocks,
  touchCapacityLocks,
} from "@/lib/registrations/capacity";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });

  try {
    const role = getUserRole(user);
    const registrationsCollection = getFirebaseAdminFirestore().collection("registrations");
    let snapshot: FirebaseFirestore.QuerySnapshot;
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

  let body: Record<string, unknown>;
  try {
    const parsedBody: unknown = await request.json();
    if (
      typeof parsedBody !== "object" ||
      parsedBody === null ||
      Array.isArray(parsedBody)
    ) {
      return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
    }
    body = parsedBody as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const input = parseHikerRegistrationInput(body);
  if (!input) {
    return NextResponse.json({ error: "Periksa kembali data pendakian." }, { status: 400 });
  }

  try {
    const firestore = getFirebaseAdminFirestore();
    const mountainRef = firestore.collection("mountains").doc(input.mountainId);
    const registrationRef = firestore.collection("registrations").doc();
    const capacityLocks = getCapacityLockRefs(firestore, [
      { mountainId: input.mountainId, days: input.days },
    ]);
    await firestore.runTransaction(async (transaction) => {
      const mountainQuery = firestore
        .collection("registrations")
        .where("mountainId", "==", input.mountainId);
      const [mountain, registrations] = await Promise.all([
        transaction.get(mountainRef),
        transaction.get(mountainQuery),
        readCapacityLocks(transaction, capacityLocks),
      ]);

      if (!mountain.exists || mountain.get("visibility") !== "public") {
        throw new Error("MOUNTAIN_NOT_AVAILABLE");
      }
      if (!isMountainOpenForRegistration(mountain.get("status"))) {
        throw new Error("MOUNTAIN_CLOSED");
      }
      if (
        !isCapacityAvailable({
          registrations,
          days: input.days,
          groupSize: input.groupSize,
          quota: mountain.get("quota"),
        })
      ) {
        throw new Error("MOUNTAIN_CAPACITY_FULL");
      }

      touchCapacityLocks(transaction, capacityLocks);
      transaction.create(registrationRef, {
        ownerUid: user.uid,
        ownerEmail: user.email,
        ownerName: user.name ?? user.username ?? user.email,
        mountainId: mountain.id,
        ...(typeof mountain.get("basecampId") === "string"
          ? { basecampId: mountain.get("basecampId") }
          : {}),
        mountainName: typeof mountain.get("name") === "string" ? mountain.get("name") : "Gunung",
        startDate: input.startDate,
        endDate: input.endDate,
        groupSize: input.groupSize,
        emergencyContactName: input.emergencyContactName,
        emergencyContactPhone: input.emergencyContactPhone,
        notes: input.notes,
        status: "pending",
        ticketCode: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return NextResponse.json({ ok: true, registrationId: registrationRef.id }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "MOUNTAIN_NOT_AVAILABLE") {
        return NextResponse.json({ error: "Gunung tidak tersedia untuk pendaftaran." }, { status: 404 });
      }
      if (error.message === "MOUNTAIN_CLOSED") {
        return NextResponse.json({ error: "Jalur sedang tidak dibuka untuk pendaftaran." }, { status: 409 });
      }
      if (error.message === "MOUNTAIN_CAPACITY_FULL") {
        return NextResponse.json({ error: "Kuota harian tidak mencukupi untuk jumlah anggota pada tanggal yang dipilih." }, { status: 409 });
      }
    }
    console.error("Could not submit mountain registration:", error);
    return NextResponse.json({ error: "Pendaftaran belum dapat disimpan." }, { status: 500 });
  }
}
