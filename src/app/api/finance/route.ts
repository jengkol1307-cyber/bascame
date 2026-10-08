import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionUser } from "@/lib/auth/session";
import { getAssignedBasecampId, getUserRole, hasPermission } from "@/lib/auth/roles";
import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";

type FinanceBody = {
  registrationId?: unknown;
  type?: unknown;
  amount?: unknown;
  method?: unknown;
  reference?: unknown;
  note?: unknown;
};

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  if (!hasPermission(user, "finance:read")) {
    return NextResponse.json({ error: "Akses ke data keuangan ditolak." }, { status: 403 });
  }
  const role = getUserRole(user);
  const basecampId = getAssignedBasecampId(user);
  if (!basecampId && role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "Akun belum ditautkan ke Basecamp." }, { status: 409 });
  }

  try {
    const ledger = getFirebaseAdminFirestore().collection("financialTransactions");
    const snapshot =
      basecampId && role !== "admin" && role !== "superadmin"
        ? await ledger.where("basecampId", "==", basecampId).limit(250).get()
        : await ledger.limit(250).get();
    const transactions = snapshot.docs
      .sort((a, b) => {
        const aDate = a.get("createdAt") as { toMillis?: () => number } | undefined;
        const bDate = b.get("createdAt") as { toMillis?: () => number } | undefined;
        return (bDate?.toMillis?.() ?? 0) - (aDate?.toMillis?.() ?? 0);
      })
      .map((doc) => ({ id: doc.id, ...doc.data() }));
    return NextResponse.json({ transactions });
  } catch (error) {
    console.error("Could not load financial transactions:", error);
    return NextResponse.json({ error: "Data keuangan belum dapat dimuat." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  if (!hasPermission(user, "finance:write")) {
    return NextResponse.json({ error: "Akses pencatatan keuangan ditolak." }, { status: 403 });
  }
  let body: FinanceBody;
  try {
    body = (await request.json()) as FinanceBody;
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const registrationId =
    typeof body.registrationId === "string" ? body.registrationId.trim() : "";
  const type = body.type;
  const amount = body.amount;
  const method = body.method;
  const reference = typeof body.reference === "string" ? body.reference.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (
    !registrationId ||
    !["charge", "payment", "refund"].includes(String(type)) ||
    typeof amount !== "number" ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    !["cash", "bank_transfer", "other"].includes(String(method)) ||
    reference.length > 100 ||
    note.length > 500
  ) {
    return NextResponse.json({ error: "Periksa kembali data transaksi." }, { status: 400 });
  }

  const role = getUserRole(user);
  const assignedBasecampId = getAssignedBasecampId(user);
  const isPlatformAdmin = role === "admin" || role === "superadmin";
  try {
    const firestore = getFirebaseAdminFirestore();
    const registrationRef = firestore.collection("registrations").doc(registrationId);
    const transactionRef = firestore.collection("financialTransactions").doc();
    await firestore.runTransaction(async (transaction) => {
      const registration = await transaction.get(registrationRef);
      if (!registration.exists) throw new Error("REGISTRATION_NOT_FOUND");
      const basecampId = registration.get("basecampId");
      if (
        typeof basecampId !== "string" ||
        (!isPlatformAdmin && (!assignedBasecampId || basecampId !== assignedBasecampId))
      ) {
        throw new Error("REGISTRATION_SCOPE_DENIED");
      }

      const existing = await transaction.get(
        firestore
          .collection("financialTransactions")
          .where("registrationId", "==", registrationId),
      );
      let charges = 0;
      let payments = 0;
      let refunds = 0;
      for (const entry of existing.docs) {
        const entryAmount = entry.get("amount");
        if (typeof entryAmount !== "number") continue;
        if (entry.get("type") === "charge") charges += entryAmount;
        if (entry.get("type") === "payment") payments += entryAmount;
        if (entry.get("type") === "refund") refunds += entryAmount;
      }
      if (type === "payment" && amount > charges - payments + refunds) {
        throw new Error("PAYMENT_EXCEEDS_BALANCE");
      }
      if (type === "refund" && amount > payments - refunds) {
        throw new Error("REFUND_EXCEEDS_PAYMENT");
      }

      transaction.set(transactionRef, {
        registrationId,
        basecampId,
        type,
        amount,
        method,
        ...(reference ? { reference } : {}),
        ...(note ? { note } : {}),
        recordedBy: user.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    return NextResponse.json({ ok: true, transactionId: transactionRef.id }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "REGISTRATION_NOT_FOUND") {
        return NextResponse.json({ error: "Pendaftaran tidak ditemukan." }, { status: 404 });
      }
      if (error.message === "REGISTRATION_SCOPE_DENIED") {
        return NextResponse.json({ error: "Akses ke pendaftaran ini ditolak." }, { status: 403 });
      }
      if (error.message === "PAYMENT_EXCEEDS_BALANCE") {
        return NextResponse.json({ error: "Pembayaran melebihi total tagihan yang belum dibayar." }, { status: 409 });
      }
      if (error.message === "REFUND_EXCEEDS_PAYMENT") {
        return NextResponse.json({ error: "Refund melebihi jumlah pembayaran." }, { status: 409 });
      }
    }
    console.error("Could not record financial transaction:", error);
    return NextResponse.json({ error: "Transaksi belum dapat disimpan." }, { status: 500 });
  }
}
