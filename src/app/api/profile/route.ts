import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getRequestUser } from "@/lib/auth/session";
import {
  getFirebaseAdminAuth,
  getFirebaseAdminFirestore,
} from "@/lib/firebase/admin";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });

  try {
    const document = await getFirebaseAdminFirestore().collection("users").doc(user.uid).get();
    const data = document.data() ?? {};
    return NextResponse.json({
      profile: {
        email: user.email ?? "",
        fullName: data.fullName ?? user.name ?? "",
        username: data.username ?? user.username ?? "",
        phone: data.phone ?? "",
        emergencyContactName: data.emergencyContactName ?? "",
        emergencyContactPhone: data.emergencyContactPhone ?? "",
      },
    });
  } catch (error) {
    console.error("Could not load user profile:", error);
    return NextResponse.json({ error: "Profil belum dapat dimuat." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const emergencyContactName =
    typeof body.emergencyContactName === "string" ? body.emergencyContactName.trim() : "";
  const emergencyContactPhone =
    typeof body.emergencyContactPhone === "string" ? body.emergencyContactPhone.trim() : "";

  if (
    fullName.length < 2 ||
    fullName.length > 80 ||
    phone.length > 32 ||
    emergencyContactName.length > 80 ||
    emergencyContactPhone.length > 32 ||
    ((emergencyContactName.length > 0) !== (emergencyContactPhone.length > 0))
  ) {
    return NextResponse.json({ error: "Periksa kembali data profil dan kontak darurat." }, { status: 400 });
  }

  try {
    const firestore = getFirebaseAdminFirestore();
    await Promise.all([
      getFirebaseAdminAuth().updateUser(user.uid, { displayName: fullName }),
      firestore.collection("users").doc(user.uid).set(
        {
          fullName,
          phone,
          emergencyContactName,
          emergencyContactPhone,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      ),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Could not update user profile:", error);
    return NextResponse.json({ error: "Profil belum dapat disimpan." }, { status: 500 });
  }
}
