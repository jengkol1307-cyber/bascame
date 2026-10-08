import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getRequestUser, getSessionUser } from "@/lib/auth/session";
import { getAssignedBasecampId, getUserRole, hasPermission } from "@/lib/auth/roles";
import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";
import {
  getCapacityLockRefs,
  getTripDays,
  isCapacityAvailable,
  isMountainOpenForRegistration,
  parseHikerRegistrationInput,
  readCapacityLocks,
  touchCapacityLocks,
} from "@/lib/registrations/capacity";

type RouteContext = {
  params: Promise<{ registrationId: string }>;
};

type UpdateBody = {
  status?: unknown;
  note?: unknown;
};

function readObjectBody(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function registrationErrorResponse(error: unknown) {
  if (!(error instanceof Error)) return null;
  switch (error.message) {
    case "REGISTRATION_NOT_FOUND":
      return NextResponse.json({ error: "Pendaftaran tidak ditemukan." }, { status: 404 });
    case "REGISTRATION_SCOPE_DENIED":
      return NextResponse.json({ error: "Akses ke pendaftaran ini ditolak." }, { status: 403 });
    case "REGISTRATION_NOT_EDITABLE":
      return NextResponse.json(
        { error: "Pengajuan hanya dapat diubah atau dibatalkan saat menunggu atau perlu revisi." },
        { status: 409 },
      );
    case "MOUNTAIN_NOT_AVAILABLE":
      return NextResponse.json({ error: "Gunung tidak tersedia untuk pendaftaran." }, { status: 404 });
    case "MOUNTAIN_CLOSED":
      return NextResponse.json({ error: "Jalur sedang tidak dibuka untuk pendaftaran." }, { status: 409 });
    case "MOUNTAIN_CAPACITY_FULL":
      return NextResponse.json(
        { error: "Kuota harian tidak mencukupi untuk jumlah anggota pada tanggal yang dipilih." },
        { status: 409 },
      );
    default:
      return null;
  }
}

async function updateOwnRegistration(
  request: Request,
  registrationId: string,
  user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>,
) {
  let body: Record<string, unknown>;
  try {
    const parsedBody = readObjectBody(await request.json());
    if (!parsedBody) {
      return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
    }
    body = parsedBody;
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }
  const input = parseHikerRegistrationInput(body);
  if (!input) {
    return NextResponse.json({ error: "Periksa kembali data pendakian." }, { status: 400 });
  }

  try {
    const firestore = getFirebaseAdminFirestore();
    const registrationRef = firestore.collection("registrations").doc(registrationId);
    await firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(registrationRef);
      if (!current.exists) throw new Error("REGISTRATION_NOT_FOUND");
      const currentData = current.data()!;
      if (currentData.ownerUid !== user.uid) throw new Error("REGISTRATION_SCOPE_DENIED");
      if (!["pending", "revision_requested", "needs_revision"].includes(String(currentData.status))) {
        throw new Error("REGISTRATION_NOT_EDITABLE");
      }
      if (
        typeof currentData.mountainId !== "string" ||
        currentData.mountainId.includes("/") ||
        typeof currentData.startDate !== "string" ||
        typeof currentData.endDate !== "string"
      ) {
        throw new Error("REGISTRATION_NOT_EDITABLE");
      }

      const previousDays = getTripDays(currentData.startDate, currentData.endDate);
      if (!previousDays) throw new Error("REGISTRATION_NOT_EDITABLE");
      const reservations = [
        { mountainId: currentData.mountainId, days: previousDays },
        { mountainId: input.mountainId, days: input.days },
      ];
      const capacityLocks = getCapacityLockRefs(firestore, reservations);
      const mountainRef = firestore.collection("mountains").doc(input.mountainId);
      const mountainQuery = firestore
        .collection("registrations")
        .where("mountainId", "==", input.mountainId);
      const [mountain, registrations] = await Promise.all([
        transaction.get(mountainRef),
        transaction.get(mountainQuery),
        readCapacityLocks(transaction, capacityLocks),
      ]).then(([mountainSnapshot, registrationSnapshot]) => [
        mountainSnapshot,
        registrationSnapshot,
      ] as const);

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
          excludeId: current.id,
        })
      ) {
        throw new Error("MOUNTAIN_CAPACITY_FULL");
      }

      touchCapacityLocks(transaction, capacityLocks);
      transaction.update(registrationRef, {
        mountainId: mountain.id,
        ...(typeof mountain.get("latitude") === "number" &&
          typeof mountain.get("longitude") === "number"
          ? {
              mountainLatitude: mountain.get("latitude"),
              mountainLongitude: mountain.get("longitude"),
            }
          : {
              mountainLatitude: FieldValue.delete(),
              mountainLongitude: FieldValue.delete(),
            }),
        ...(typeof mountain.get("basecampId") === "string"
          ? { basecampId: mountain.get("basecampId") }
          : { basecampId: FieldValue.delete() }),
        mountainName: typeof mountain.get("name") === "string" ? mountain.get("name") : "Gunung",
        startDate: input.startDate,
        endDate: input.endDate,
        groupSize: input.groupSize,
        emergencyContactName: input.emergencyContactName,
        emergencyContactPhone: input.emergencyContactPhone,
        notes: input.notes,
        status: "pending",
        decisionNote: FieldValue.delete(),
        decisionBy: FieldValue.delete(),
        decisionAt: FieldValue.delete(),
        ticketCode: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = registrationErrorResponse(error);
    if (response) return response;
    console.error("Could not update hiker registration:", error);
    return NextResponse.json({ error: "Pengajuan belum dapat diperbarui." }, { status: 500 });
  }
}

async function cancelOwnRegistration(
  registrationId: string,
  user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>,
) {
  try {
    const firestore = getFirebaseAdminFirestore();
    const registrationRef = firestore.collection("registrations").doc(registrationId);
    await firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(registrationRef);
      if (!current.exists) throw new Error("REGISTRATION_NOT_FOUND");
      const data = current.data()!;
      if (data.ownerUid !== user.uid) throw new Error("REGISTRATION_SCOPE_DENIED");
      if (!["pending", "revision_requested", "needs_revision"].includes(String(data.status))) {
        throw new Error("REGISTRATION_NOT_EDITABLE");
      }

      const days = getTripDays(data.startDate, data.endDate);
      const capacityLocks =
        typeof data.mountainId === "string" && days
          ? getCapacityLockRefs(firestore, [{ mountainId: data.mountainId, days }])
          : [];
      await readCapacityLocks(transaction, capacityLocks);
      touchCapacityLocks(transaction, capacityLocks);
      transaction.update(registrationRef, {
        status: "cancelled",
        cancelledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = registrationErrorResponse(error);
    if (response) return response;
    console.error("Could not cancel hiker registration:", error);
    return NextResponse.json({ error: "Pengajuan belum dapat dibatalkan." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  if (getUserRole(user) === "user") {
    const { registrationId } = await context.params;
    return updateOwnRegistration(request, registrationId, user);
  }

  let body: UpdateBody;
  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const role = getUserRole(user);
  const isPlatformAdmin = role === "admin" || role === "superadmin";
  const canDecide = hasPermission(user, "registrations:decide");
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > 500) {
    return NextResponse.json({ error: "Catatan maksimal 500 karakter." }, { status: 400 });
  }

  let update: Record<string, unknown>;
  if (
    canDecide &&
    ["approved", "rejected", "revision_requested"].includes(String(body.status))
  ) {
    if (
      ["rejected", "revision_requested"].includes(String(body.status)) &&
      note.length < 3
    ) {
      return NextResponse.json(
        { error: "Berikan alasan untuk penolakan atau permintaan revisi." },
        { status: 400 },
      );
    }
    update = {
      status: body.status,
      decisionBy: user.uid,
      decisionAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(note ? { decisionNote: note } : {}),
      ...(body.status === "approved"
        ? { ticketCode: `BC-${randomBytes(16).toString("hex").toUpperCase()}` }
        : {}),
    };
  } else {
    return NextResponse.json({ error: "Aksi tidak diizinkan." }, { status: 403 });
  }

  const { registrationId } = await context.params;
  try {
    const firestore = getFirebaseAdminFirestore();
    const registrationRef = firestore.collection("registrations").doc(registrationId);
    await firestore.runTransaction(async (transaction) => {
      const registration = await transaction.get(registrationRef);
      if (!registration.exists) throw new Error("REGISTRATION_NOT_FOUND");
      const data = registration.data()!;
      if (!isPlatformAdmin) {
        const basecampId = getAssignedBasecampId(user);
        if (!basecampId || data.basecampId !== basecampId) {
          throw new Error("REGISTRATION_SCOPE_DENIED");
        }
      }

      if (
        canDecide &&
        body.status &&
        !["pending", "revision_requested", "needs_revision"].includes(String(data.status))
      ) {
        throw new Error("REGISTRATION_NOT_DECIDABLE");
      }
      transaction.update(registrationRef, update);
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "REGISTRATION_NOT_FOUND") {
        return NextResponse.json({ error: "Pendaftaran tidak ditemukan." }, { status: 404 });
      }
      if (error.message === "REGISTRATION_SCOPE_DENIED") {
        return NextResponse.json({ error: "Akses ke pendaftaran ini ditolak." }, { status: 403 });
      }
      if (error.message === "REGISTRATION_NOT_DECIDABLE") {
        return NextResponse.json(
          { error: "Pendaftaran ini tidak dapat diproses pada status saat ini." },
          { status: 409 },
        );
      }
    }
    console.error("Could not update registration status:", error);
    return NextResponse.json({ error: "Status pendaftaran belum dapat diperbarui." }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  if (getUserRole(user) !== "user") {
    return NextResponse.json({ error: "Hanya pemilik pengajuan yang dapat membatalkannya." }, { status: 403 });
  }
  const { registrationId } = await context.params;
  return cancelOwnRegistration(registrationId, user);
}
