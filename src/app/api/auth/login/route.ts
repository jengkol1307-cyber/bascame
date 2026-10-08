import { NextResponse } from "next/server";
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from "@/lib/firebase/admin";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

const SESSION_DURATION_MS = 5 * 24 * 60 * 60 * 1000;
const FIREBASE_AUTH_ERROR =
  "Email/username atau kata sandi salah.";

type LoginRequest = {
  identifier?: unknown;
  password?: unknown;
};

async function resolveEmail(identifier: string) {
  if (identifier.includes("@")) return identifier.toLowerCase();

  const normalizedUsername = identifier.toLowerCase();
  const firestore = getFirebaseAdminFirestore();
  const usernameIndex = await firestore
    .collection("usernames")
    .doc(normalizedUsername)
    .get();
  if (usernameIndex.exists) {
    const uid = usernameIndex.get("uid");
    if (typeof uid === "string") {
      const indexedUser = await firestore.collection("users").doc(uid).get();
      const indexedEmail = indexedUser.get("email");
      if (typeof indexedEmail === "string") return indexedEmail.toLowerCase();
    }
  }

  const users = firestore.collection("users");
  const normalizedMatch = await users
    .where("usernameNormalized", "==", normalizedUsername)
    .limit(1)
    .get();
  const profile = normalizedMatch.empty
    ? await users.where("username", "==", normalizedUsername).limit(1).get()
    : normalizedMatch;

  if (profile.empty) return null;
  const email = profile.docs[0].get("email");
  return typeof email === "string" ? email.toLowerCase() : null;
}

export async function POST(request: Request) {
  let body: LoginRequest;
  try {
    body = (await request.json()) as LoginRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (
    typeof body.identifier !== "string" ||
    typeof body.password !== "string" ||
    body.identifier.trim().length < 1 ||
    body.identifier.trim().length > 254 ||
    body.password.length < 1 ||
    body.password.length > 128
  ) {
    return NextResponse.json({ error: "Enter your username/email and password." }, { status: 400 });
  }

  const identifier = body.identifier.trim();
  try {
    const email = await resolveEmail(identifier);
    if (!email) {
      return NextResponse.json({ error: FIREBASE_AUTH_ERROR }, { status: 401 });
    }

    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!apiKey) {
      throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is not configured.");
    }

    const firebaseResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: body.password,
          returnSecureToken: true,
        }),
        cache: "no-store",
      },
    );

    if (!firebaseResponse.ok) {
      const error = (await firebaseResponse.json()) as {
        error?: { message?: string };
      };
      if (
        error.error?.message === "INVALID_LOGIN_CREDENTIALS" ||
        error.error?.message === "EMAIL_NOT_FOUND" ||
        error.error?.message === "INVALID_PASSWORD" ||
        error.error?.message === "USER_DISABLED"
      ) {
        return NextResponse.json({ error: FIREBASE_AUTH_ERROR }, { status: 401 });
      }
      console.error("Firebase password sign-in failed:", error.error?.message);
      return NextResponse.json({ error: "Sign-in is temporarily unavailable." }, { status: 502 });
    }

    const tokens = (await firebaseResponse.json()) as { idToken?: string };
    if (!tokens.idToken) {
      throw new Error("Firebase password sign-in response did not include an ID token.");
    }

    const auth = getFirebaseAdminAuth();
    const decodedToken = await auth.verifyIdToken(tokens.idToken);
    const sessionCookie = await auth.createSessionCookie(tokens.idToken, {
      expiresIn: SESSION_DURATION_MS,
    });
    const role =
      decodedToken.role === "superadmin"
        ? "superadmin"
        : decodedToken.role === "admin"
          ? "admin"
          : "user";
    const response = NextResponse.json({ ok: true, role });
    response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION_MS / 1000,
    });
    return response;
  } catch (error) {
    console.error("Username/email sign-in failed:", error);
    return NextResponse.json(
      { error: "Sign-in is temporarily unavailable. Check the server configuration." },
      { status: 500 },
    );
  }
}
