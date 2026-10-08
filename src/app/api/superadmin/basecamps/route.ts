import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/roles";
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from "@/lib/firebase/admin";

type BasecampBody = {
  name?: unknown;
  adminName?: unknown;
  username?: unknown;
  email?: unknown;
  temporaryPassword?: unknown;
};

async function requireSuperadmin() {
  const user = await getSessionUser();
  if (!user) return { response: NextResponse.json({ error: "Silakan masuk." }, { status: 401 }) };
  if (user.role !== "superadmin" || !hasPermission(user, "basecamp:provision")) {
    return { response: NextResponse.json({ error: "Akses ditolak." }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const access = await requireSuperadmin();
  if (access.response) return access.response;

  try {
    const snapshot = await getFirebaseAdminFirestore()
      .collection("basecamps")
      .orderBy("createdAt", "desc")
      .get();
    return NextResponse.json({
      basecamps: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    });
  } catch (error) {
    console.error("Could not list Basecamps:", error);
    return NextResponse.json({ error: "Daftar Basecamp belum dapat dimuat." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const access = await requireSuperadmin();
  if (access.response) return access.response;

  let body: BasecampBody;
  try {
    body = (await request.json()) as BasecampBody;
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const adminName = typeof body.adminName === "string" ? body.adminName.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const temporaryPassword =
    typeof body.temporaryPassword === "string" ? body.temporaryPassword : "";
  if (
    name.length < 2 ||
    name.length > 100 ||
    adminName.length < 2 ||
    adminName.length > 100 ||
    !/^[a-z0-9._-]{3,30}$/.test(username) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    temporaryPassword.length < 8 ||
    temporaryPassword.length > 128
  ) {
    return NextResponse.json(
      { error: "Periksa nama Basecamp, data admin, dan sandi sementara." },
      { status: 400 },
    );
  }

  const auth = getFirebaseAdminAuth();
  const firestore = getFirebaseAdminFirestore();
  let createdUid: string | undefined;
  let basecampId: string | undefined;
  try {
    const account = await auth.createUser({
      displayName: adminName,
      email,
      password: temporaryPassword,
    });
    createdUid = account.uid;
    const basecampRef = firestore.collection("basecamps").doc();
    basecampId = basecampRef.id;
    const usernameRef = firestore.collection("usernames").doc(username);
    const profileRef = firestore.collection("users").doc(account.uid);
    const staffRef = basecampRef.collection("staff").doc(account.uid);

    await firestore.runTransaction(async (transaction) => {
      const usernameSnapshot = await transaction.get(usernameRef);
      if (usernameSnapshot.exists) throw new Error("USERNAME_TAKEN");
      transaction.set(basecampRef, {
        name,
        status: "active",
        visibility: "private",
        createdBy: access.user!.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(usernameRef, { uid: account.uid });
      transaction.set(profileRef, {
        uid: account.uid,
        fullName: adminName,
        name: adminName,
        username,
        usernameNormalized: username,
        email,
        role: "basecamp_admin",
        basecampId,
        accountType: "staff",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(staffRef, {
        uid: account.uid,
        fullName: adminName,
        username,
        email,
        role: "basecamp_admin",
        createdBy: access.user!.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    await auth.setCustomUserClaims(account.uid, {
      role: "basecamp_admin",
      basecampId,
      username,
      mustChangePassword: true,
    });
    return NextResponse.json({ ok: true, basecampId }, { status: 201 });
  } catch (error) {
    if (createdUid) {
      try {
        await auth.deleteUser(createdUid);
        const usernameRef = firestore.collection("usernames").doc(username);
        if ((await usernameRef.get()).get("uid") === createdUid) await usernameRef.delete();
        await firestore.collection("users").doc(createdUid).delete();
        if (basecampId) {
          await firestore.collection("basecamps").doc(basecampId).delete();
          await firestore
            .collection("basecamps")
            .doc(basecampId)
            .collection("staff")
            .doc(createdUid)
            .delete();
        }
      } catch (cleanupError) {
        console.error("Could not clean up a failed Basecamp setup:", cleanupError);
      }
    }
    const code = (error as { code?: string }).code;
    if (error instanceof Error && error.message === "USERNAME_TAKEN") {
      return NextResponse.json({ error: "Username sudah digunakan." }, { status: 409 });
    }
    if (code === "auth/email-already-exists") {
      return NextResponse.json({ error: "Email sudah memiliki akun." }, { status: 409 });
    }
    console.error("Could not provision Basecamp and its admin:", error);
    return NextResponse.json({ error: "Basecamp belum dapat dibuat." }, { status: 500 });
  }
}
