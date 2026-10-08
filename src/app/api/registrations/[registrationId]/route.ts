import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionUser } from "@/lib/auth/session";
import { getAssignedBasecampId, getUserRole, hasPermission } from "@/lib/auth/roles";
import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";

type RouteContext = {
  params: Promise<{ registrationId: string }>;
};

type UpdateBody = {
  status?: unknown;
  note?: unknown;
  action?: unknown;
};

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });

  let body: UpdateBody;
  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }
  const role = getUserRole(user);
  const isPlatformAdmin = role === "admin" || role === "superadmin";
  const canDecide = hasPermission(user, "registrations:decide");
  const canCheckIn = hasPermission(user, "field:checkin");
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
        ? { ticketCode: `BC-${randomBytes(5).toString("hex").toUpperCase()}` }
        : {}),
    };
  } else if (canCheckIn && body.action === "check_in") {
    update = {
      status: "checked_in",
      checkedInBy: user.uid,
      checkedInAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
  } else if (canCheckIn && body.action === "check_out") {
    update = {
      status: "checked_out",
      checkedOutBy: user.uid,
      checkedOutAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
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
        !["pending", "revision_requested"].includes(String(data.status))
      ) {
        throw new Error("REGISTRATION_NOT_DECIDABLE");
      }
      if (body.action === "check_in" && data.status !== "approved") {
        throw new Error("REGISTRATION_NOT_CHECKIN_READY");
      }
      if (body.action === "check_out" && data.status !== "checked_in") {
        throw new Error("REGISTRATION_NOT_CHECKED_IN");
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
      if (error.message === "REGISTRATION_NOT_CHECKIN_READY") {
        return NextResponse.json(
          { error: "Hanya pendaftaran yang disetujui yang dapat check-in." },
          { status: 409 },
        );
      }
      if (error.message === "REGISTRATION_NOT_CHECKED_IN") {
        return NextResponse.json(
          { error: "Pendaki harus check-in sebelum check-out." },
          { status: 409 },
        );
      }
    }
    console.error("Could not update registration status:", error);
    return NextResponse.json({ error: "Status pendaftaran belum dapat diperbarui." }, { status: 500 });
  }
}
