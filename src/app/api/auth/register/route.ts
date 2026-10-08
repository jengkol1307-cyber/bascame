import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  getFirebaseAdminAuth,
  getFirebaseAdminFirestore,
} from "@/lib/firebase/admin";

type RegistrationRequest = {
  idToken?: unknown;
  fullName?: unknown;
  username?: unknown;
  phone?: unknown;
};

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;
const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "api",
  "basecamp",
  "root",
  "superadmin",
  "support",
  "system",
]);

export async function POST(request: Request) {
  let body: RegistrationRequest;
  try {
    body = (await request.json()) as RegistrationRequest;
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  if (
    typeof body.idToken !== "string" ||
    typeof body.fullName !== "string" ||
    typeof body.username !== "string" ||
    (body.phone !== undefined && typeof body.phone !== "string")
  ) {
    return NextResponse.json({ error: "Data pendaftaran tidak lengkap." }, { status: 400 });
  }

  const fullName = body.fullName.trim();
  const username = body.username.trim();
  const usernameNormalized = username.toLowerCase();
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";

  if (fullName.length < 2 || fullName.length > 80) {
    return NextResponse.json(
      { error: "Nama lengkap harus berisi 2 sampai 80 karakter." },
      { status: 400 },
    );
  }
  if (!USERNAME_PATTERN.test(username) || RESERVED_USERNAMES.has(usernameNormalized)) {
    return NextResponse.json(
      { error: "Username 3–20 karakter: gunakan huruf, angka, atau garis bawah." },
      { status: 400 },
    );
  }
  if (phone.length > 32) {
    return NextResponse.json({ error: "Nomor telepon terlalu panjang." }, { status: 400 });
  }

  try {
    const auth = getFirebaseAdminAuth();
    const decodedToken = await auth.verifyIdToken(body.idToken);
    if (!decodedToken.email || decodedToken.email_verified) {
      return NextResponse.json(
        { error: "Token akun tidak cocok untuk pendaftaran." },
        { status: 401 },
      );
    }
    if (Date.now() / 1000 - decodedToken.auth_time > 5 * 60) {
      return NextResponse.json(
        { error: "Buat akun kembali untuk menyelesaikan pendaftaran." },
        { status: 401 },
      );
    }

    const userRecord = await auth.getUser(decodedToken.uid);
    if (userRecord.customClaims?.role && userRecord.customClaims.role !== "user") {
      return NextResponse.json(
        { error: "Akun ini tidak dapat didaftarkan sebagai pendaki." },
        { status: 403 },
      );
    }

    const firestore = getFirebaseAdminFirestore();
    const userRef = firestore.collection("users").doc(decodedToken.uid);
    const usernameRef = firestore.collection("usernames").doc(usernameNormalized);

    await firestore.runTransaction(async (transaction) => {
      const [userSnapshot, usernameSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(usernameRef),
      ]);
      if (userSnapshot.exists) {
        throw new Error("ACCOUNT_ALREADY_REGISTERED");
      }
      if (usernameSnapshot.exists) {
        throw new Error("USERNAME_TAKEN");
      }

      const now = FieldValue.serverTimestamp();
      transaction.create(usernameRef, {
        uid: decodedToken.uid,
        username,
        usernameNormalized,
        createdAt: now,
      });
      transaction.create(userRef, {
        uid: decodedToken.uid,
        email: decodedToken.email,
        fullName,
        username,
        usernameNormalized,
        phone,
        role: "user",
        createdAt: now,
        updatedAt: now,
      });
    });

    await auth.setCustomUserClaims(decodedToken.uid, {
      ...userRecord.customClaims,
      role: "user",
      username,
    });

    return NextResponse.json({ ok: true, role: "user" }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "USERNAME_TAKEN") {
      return NextResponse.json(
        { error: "Username sudah digunakan. Silakan pilih username lain." },
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message === "ACCOUNT_ALREADY_REGISTERED") {
      return NextResponse.json(
        { error: "Akun ini sudah terdaftar. Silakan masuk." },
        { status: 409 },
      );
    }
    console.error("Pendaki registration failed:", error);
    return NextResponse.json(
      { error: "Pendaftaran belum dapat diproses. Silakan coba kembali." },
      { status: 500 },
    );
  }
}
