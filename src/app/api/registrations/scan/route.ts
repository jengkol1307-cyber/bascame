import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionUser } from "@/lib/auth/session";
import { getAssignedBasecampId, getUserRole, hasPermission } from "@/lib/auth/roles";
import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";

type ScanBody = {
  ticketCode?: unknown;
  action?: unknown;
};

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  if (!hasPermission(user, "field:checkin")) {
    return NextResponse.json({ error: "Akses pemindaian tiket ditolak." }, { status: 403 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Data QR tiket tidak valid." }, { status: 400 });
  }
  if (typeof parsedBody !== "object" || parsedBody === null || Array.isArray(parsedBody)) {
    return NextResponse.json({ error: "Data QR tiket tidak valid." }, { status: 400 });
  }
  const body = parsedBody as ScanBody;
  if (
    typeof body.ticketCode !== "string" ||
    !/^BC-[A-F0-9]{10,32}$/i.test(body.ticketCode.trim())
  ) {
    return NextResponse.json({ error: "QR tidak berisi kode tiket Basecamp yang valid." }, { status: 400 });
  }
  if (body.action !== "check_in" && body.action !== "check_out") {
    return NextResponse.json({ error: "Pilih check-in atau check-out sebelum memindai tiket." }, { status: 400 });
  }

  const role = getUserRole(user);
  const isPlatformAdmin = role === "admin" || role === "superadmin";
  const basecampId = getAssignedBasecampId(user);
  if (!isPlatformAdmin && !basecampId) {
    return NextResponse.json({ error: "Akun belum ditautkan ke Basecamp." }, { status: 409 });
  }

  try {
    const firestore = getFirebaseAdminFirestore();
    const ticketQuery = firestore
      .collection("registrations")
      .where("ticketCode", "==", body.ticketCode.trim().toUpperCase())
      .limit(10);
    const result = await firestore.runTransaction(async (transaction) => {
      const matches = await transaction.get(ticketQuery);
      const scopedMatches = matches.docs.filter(
        (document) => isPlatformAdmin || document.get("basecampId") === basecampId,
      );
      if (scopedMatches.length !== 1) {
        throw new Error(scopedMatches.length > 1 ? "TICKET_CODE_AMBIGUOUS" : "TICKET_NOT_FOUND");
      }

      const registration = scopedMatches[0];
      const data = registration.data();
      const action = body.action;
      let nextStatus: "checked_in" | "checked_out";
      let update: Record<string, unknown>;
      if (action === "check_in" && data.status === "approved") {
        nextStatus = "checked_in";
        update = {
          status: nextStatus,
          checkedInBy: user.uid,
          checkedInAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };
      } else if (action === "check_out" && data.status === "checked_in") {
        nextStatus = "checked_out";
        update = {
          status: nextStatus,
          checkedOutBy: user.uid,
          checkedOutAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };
      } else {
        throw new Error(action === "check_in" ? "TICKET_NOT_READY_FOR_CHECKIN" : "TICKET_NOT_READY_FOR_CHECKOUT");
      }

      transaction.update(registration.ref, update);
      return {
        action,
        status: nextStatus,
        mountainName: typeof data.mountainName === "string" ? data.mountainName : "Gunung",
        startDate: typeof data.startDate === "string" ? data.startDate : "",
        endDate: typeof data.endDate === "string" ? data.endDate : "",
        groupSize: typeof data.groupSize === "number" ? data.groupSize : null,
      };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "TICKET_NOT_FOUND") {
        return NextResponse.json({ error: "Tiket tidak ditemukan untuk Basecamp ini." }, { status: 404 });
      }
      if (error.message === "TICKET_CODE_AMBIGUOUS") {
        return NextResponse.json({ error: "Kode tiket terduplikasi. Hubungi administrator." }, { status: 409 });
      }
      if (error.message === "TICKET_NOT_READY_FOR_CHECKIN") {
        return NextResponse.json(
          { error: "Check-in hanya dapat dilakukan pada tiket yang sudah disetujui." },
          { status: 409 },
        );
      }
      if (error.message === "TICKET_NOT_READY_FOR_CHECKOUT") {
        return NextResponse.json(
          { error: "Check-out hanya dapat dilakukan setelah pendaki check-in." },
          { status: 409 },
        );
      }
    }
    console.error("Could not process scanned registration ticket:", error);
    return NextResponse.json({ error: "Tiket belum dapat diproses." }, { status: 500 });
  }
}
