import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionUser } from "@/lib/auth/session";
import { getAssignedBasecampId, hasPermission, isStaffRole } from "@/lib/auth/roles";
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from "@/lib/firebase/admin";

type StaffBody = {
  fullName?: unknown;
  username?: unknown;
  email?: unknown;
  phone?: unknown;
  temporaryPassword?: unknown;
  role?: unknown;
};

async function managerScope() {
  const user = await getSessionUser();
  if (!user) return { response: NextResponse.json({ error: "Silakan masuk." }, { status: 401 }) };
  if (!hasPermission(user, "staff:manage")) {
    return { response: NextResponse.json({ error: "Akses ditolak." }, { status: 403 }) };
  }
  const basecampId = getAssignedBasecampId(user);
  if (user.role !== "admin" && !basecampId) {
    return {
      response: NextResponse.json(
        { error: "Akun admin belum ditautkan ke Basecamp." },
        { status: 409 },
      ),
    };
  }
  return { user, basecampId };
}

export async function GET() {
  const scope = await managerScope();
  if (scope.response) return scope.response;

  try {
    const basecampId = scope.basecampId;
    if (!basecampId) {
      const snapshot = await getFirebaseAdminFirestore()
        .collectionGroup("staff")
        .get();
      return NextResponse.json({
        staff: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
        currentUserUid: scope.user!.uid,
      });
    }
    const snapshot = await getFirebaseAdminFirestore()
      .collection("basecamps")
      .doc(basecampId)
      .collection("staff")
      .orderBy("createdAt", "desc")
      .get();
    return NextResponse.json({
      staff: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      currentUserUid: scope.user!.uid,
    });
  } catch (error) {
    console.error("Could not list Basecamp staff:", error);
    return NextResponse.json({ error: "Daftar staf belum dapat dimuat." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const scope = await managerScope();
  if (scope.response) return scope.response;
  if (!scope.basecampId) {
    return NextResponse.json(
      { error: "Admin harus memiliki satu Basecamp sebelum menambahkan staf." },
      { status: 409 },
    );
  }

  let body: StaffBody;
  try {
    body = (await request.json()) as StaffBody;
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const temporaryPassword =
    typeof body.temporaryPassword === "string" ? body.temporaryPassword : "";

  if (
    fullName.length < 2 ||
    fullName.length > 100 ||
    !/^[a-z0-9._-]{3,30}$/.test(username) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    phone.length > 32 ||
    temporaryPassword.length < 8 ||
    temporaryPassword.length > 128 ||
    !isStaffRole(body.role)
  ) {
    return NextResponse.json(
      { error: "Periksa nama, username, email, sandi sementara, dan role." },
      { status: 400 },
    );
  }

  const auth = getFirebaseAdminAuth();
  const firestore = getFirebaseAdminFirestore();
  let createdUid: string | undefined;
  try {
    const basecamp = await firestore.collection("basecamps").doc(scope.basecampId).get();
    if (!basecamp.exists || basecamp.get("status") !== "active") {
      return NextResponse.json(
        { error: "Basecamp tidak ditemukan atau tidak aktif." },
        { status: 409 },
      );
    }
    const userRecord = await auth.createUser({
      displayName: fullName,
      email,
      password: temporaryPassword,
    });
    createdUid = userRecord.uid;
    const usernameRef = firestore.collection("usernames").doc(username);
    const profileRef = firestore.collection("users").doc(userRecord.uid);
    const staffRef = firestore
      .collection("basecamps")
      .doc(scope.basecampId)
      .collection("staff")
      .doc(userRecord.uid);

    await firestore.runTransaction(async (transaction) => {
      const usernameDoc = await transaction.get(usernameRef);
      if (usernameDoc.exists) throw new Error("USERNAME_TAKEN");
      transaction.set(usernameRef, { uid: userRecord.uid });
      transaction.set(profileRef, {
        uid: userRecord.uid,
        fullName,
        name: fullName,
        username,
        usernameNormalized: username,
        email,
        phone,
        role: body.role,
        basecampId: scope.basecampId,
        accountType: "staff",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(staffRef, {
        uid: userRecord.uid,
        fullName,
        username,
        email,
        phone,
        role: body.role,
        createdBy: scope.user!.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    await auth.setCustomUserClaims(userRecord.uid, {
      role: body.role,
      basecampId: scope.basecampId,
      username,
      mustChangePassword: true,
    });
    return NextResponse.json({ ok: true, uid: userRecord.uid }, { status: 201 });
  } catch (error) {
    if (createdUid) {
      try {
        await auth.deleteUser(createdUid);
        const usernameRef = firestore.collection("usernames").doc(username);
        const usernameDoc = await usernameRef.get();
        if (usernameDoc.get("uid") === createdUid) await usernameRef.delete();
        await firestore.collection("users").doc(createdUid).delete();
        await firestore
          .collection("basecamps")
          .doc(scope.basecampId)
          .collection("staff")
          .doc(createdUid)
          .delete();
      } catch (cleanupError) {
        console.error("Could not clean up a failed staff-account creation:", cleanupError);
      }
    }
    const errorCode = (error as { code?: string }).code;
    if (error instanceof Error && error.message === "USERNAME_TAKEN") {
      return NextResponse.json({ error: "Username sudah digunakan." }, { status: 409 });
    }
    if (errorCode === "auth/email-already-exists") {
      return NextResponse.json({ error: "Email sudah memiliki akun." }, { status: 409 });
    }
    console.error("Could not create Basecamp staff account:", error);
    return NextResponse.json({ error: "Akun staf belum dapat dibuat." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const scope = await managerScope();
  if (scope.response) return scope.response;
  if (!scope.basecampId) {
    return NextResponse.json({ error: "Basecamp admin belum ditetapkan." }, { status: 409 });
  }

  let uid: string;
  try {
    const body = (await request.json()) as { uid?: unknown };
    if (typeof body.uid !== "string" || !body.uid) {
      return NextResponse.json({ error: "ID staf tidak valid." }, { status: 400 });
    }
    uid = body.uid;
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }
  if (uid === scope.user!.uid) {
    return NextResponse.json({ error: "Anda tidak dapat mencabut akses akun sendiri." }, { status: 400 });
  }

  try {
    const firestore = getFirebaseAdminFirestore();
    const staffRef = firestore
      .collection("basecamps")
      .doc(scope.basecampId)
      .collection("staff")
      .doc(uid);
    const staff = await staffRef.get();
    if (!staff.exists) {
      return NextResponse.json({ error: "Akun staf tidak ditemukan." }, { status: 404 });
    }
    const profileRef = firestore.collection("users").doc(uid);
    const profile = await profileRef.get();
    const username = profile.get("username");
    const auth = getFirebaseAdminAuth();
    const record = await auth.getUser(uid);
    const claims = { ...record.customClaims };
    delete claims.role;
    delete claims.basecampId;
    await auth.setCustomUserClaims(uid, { ...claims, role: "user" });
    await auth.revokeRefreshTokens(uid);
    const batch = firestore.batch();
    batch.update(profileRef, {
      role: "user",
      basecampId: FieldValue.delete(),
      accountType: "user",
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.delete(staffRef);
    if (typeof username === "string") {
      batch.set(firestore.collection("usernames").doc(username), { uid });
    }
    await batch.commit();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Could not remove Basecamp staff access:", error);
    return NextResponse.json({ error: "Akses staf belum dapat dicabut." }, { status: 500 });
  }
}
