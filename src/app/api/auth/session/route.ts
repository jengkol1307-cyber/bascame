import { NextResponse } from "next/server";
import { getFirebaseAdminAuth } from "@/lib/firebase/admin";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { getDashboardPath, getUserRole } from "@/lib/auth/roles";

const SESSION_DURATION_MS = 5 * 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  let idToken: unknown;
  try {
    ({ idToken } = (await request.json()) as { idToken?: unknown });
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (typeof idToken !== "string" || !idToken) {
    return NextResponse.json({ error: "ID token is required." }, { status: 400 });
  }

  try {
    const auth = getFirebaseAdminAuth();
    const decodedToken = await auth.verifyIdToken(idToken);
    if (decodedToken.mustChangePassword === true || getUserRole(decodedToken) === "disabled") {
      return NextResponse.json(
        { error: "Akun ini belum dapat membuat sesi." },
        { status: 403 },
      );
    }
    const authAge = Date.now() / 1000 - decodedToken.auth_time;
    if (authAge > 5 * 60) {
      return NextResponse.json(
        { error: "Please sign in again to create a session." },
        { status: 401 },
      );
    }

    const sessionCookie = await auth.createSessionCookie(idToken, {
      expiresIn: SESSION_DURATION_MS,
    });
    const response = NextResponse.json({
      ok: true,
      role: getUserRole(decodedToken),
      destination: getDashboardPath(decodedToken),
    });
    response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION_MS / 1000,
    });
    return response;
  } catch (error) {
    console.error("Firebase session creation failed:", error);
    return NextResponse.json(
      { error: "Unable to create a session. Check the server configuration." },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
