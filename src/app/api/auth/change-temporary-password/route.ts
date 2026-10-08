import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { getDashboardPath, getUserRole } from "@/lib/auth/roles";
import { resolveEmail } from "@/lib/auth/resolve-email";
import { getFirebaseAdminAuth } from "@/lib/firebase/admin";

const SESSION_DURATION_MS = 5 * 24 * 60 * 60 * 1000;
const AUTH_ERROR = "Username/email atau kata sandi salah.";

type ChangePasswordBody = {
  identifier?: unknown;
  currentPassword?: unknown;
  password?: unknown;
  newPassword?: unknown;
};

async function signIn(email: string, password: string, apiKey: string) {
  return fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      cache: "no-store",
    },
  );
}

export async function POST(request: Request) {
  let body: ChangePasswordBody;
  try {
    body = (await request.json()) as ChangePasswordBody;
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : body.password;
  if (typeof body.identifier !== "string" || !body.identifier.trim()) {
    return NextResponse.json(
      { error: "Sesi penggantian sandi tidak lengkap. Silakan masuk kembali." },
      { status: 400 },
    );
  }
  if (typeof currentPassword !== "string" || !currentPassword) {
    return NextResponse.json(
      { error: "Sandi sementara tidak terbaca. Silakan masuk kembali." },
      { status: 400 },
    );
  }
  if (typeof body.newPassword !== "string" || body.newPassword.length < 8 || body.newPassword.length > 128) {
    return NextResponse.json(
      { error: "Sandi baru harus terdiri dari 8 sampai 128 karakter." },
      { status: 400 },
    );
  }

  try {
    const email = await resolveEmail(body.identifier.trim());
    if (!email) {
      return NextResponse.json({ error: AUTH_ERROR }, { status: 401 });
    }
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!apiKey) throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is not configured.");

    const currentSignIn = await signIn(email, currentPassword, apiKey);
    if (!currentSignIn.ok) {
      const signInError = (await currentSignIn.json()) as { error?: { message?: string } };
      if (
        [
          "INVALID_LOGIN_CREDENTIALS",
          "EMAIL_NOT_FOUND",
          "INVALID_PASSWORD",
          "USER_DISABLED",
        ].includes(signInError.error?.message ?? "")
      ) {
        return NextResponse.json({ error: AUTH_ERROR }, { status: 401 });
      }
      console.error("Firebase temporary-password verification failed:", signInError.error?.message);
      return NextResponse.json({ error: "Layanan sandi sedang tidak tersedia." }, { status: 502 });
    }

    const currentTokens = (await currentSignIn.json()) as { idToken?: string };
    if (!currentTokens.idToken) throw new Error("Firebase response did not include an ID token.");
    const auth = getFirebaseAdminAuth();
    const decoded = await auth.verifyIdToken(currentTokens.idToken);
    if (decoded.mustChangePassword !== true || getUserRole(decoded) === "disabled") {
      return NextResponse.json(
        { error: "Akun ini tidak memerlukan penggantian sandi sementara." },
        { status: 409 },
      );
    }

    const updateResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken: currentTokens.idToken,
          password: body.newPassword,
          returnSecureToken: true,
        }),
        cache: "no-store",
      },
    );
    if (!updateResponse.ok) {
      const updateError = (await updateResponse.json()) as { error?: { message?: string } };
      if (
        updateError.error?.message?.startsWith("WEAK_PASSWORD") ||
        updateError.error?.message === "PASSWORD_DOES_NOT_MEET_REQUIREMENTS"
      ) {
        return NextResponse.json(
          { error: "Pilih sandi yang lebih kuat (minimal 8 karakter)." },
          { status: 400 },
        );
      }
      console.error("Firebase password update failed:", updateError.error?.message);
      return NextResponse.json({ error: "Sandi belum dapat diperbarui." }, { status: 502 });
    }

    const claims = { ...(await auth.getUser(decoded.uid)).customClaims };
    delete claims.mustChangePassword;
    await auth.setCustomUserClaims(decoded.uid, claims);

    const refreshedSignIn = await signIn(email, body.newPassword, apiKey);
    if (!refreshedSignIn.ok) {
      throw new Error("Could not refresh sign-in after updating password.");
    }
    const refreshedTokens = (await refreshedSignIn.json()) as { idToken?: string };
    if (!refreshedTokens.idToken) {
      throw new Error("Firebase refresh response did not include an ID token.");
    }
    const refreshedUser = await auth.verifyIdToken(refreshedTokens.idToken);
    const role = getUserRole(refreshedUser);
    const sessionCookie = await auth.createSessionCookie(refreshedTokens.idToken, {
      expiresIn: SESSION_DURATION_MS,
    });
    const response = NextResponse.json({
      ok: true,
      role,
      destination: getDashboardPath(refreshedUser),
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
    console.error("Could not change temporary password:", error);
    return NextResponse.json({ error: "Sandi belum dapat diperbarui." }, { status: 500 });
  }
}
