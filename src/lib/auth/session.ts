import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getFirebaseAdminAuth } from "@/lib/firebase/admin";

export const SESSION_COOKIE_NAME = "__session";

export async function getSessionUser(): Promise<DecodedIdToken | null> {
  await connection();
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;

  const auth = getFirebaseAdminAuth();
  try {
    return await auth.verifySessionCookie(sessionCookie, true);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (
      code === "auth/argument-error" ||
      code === "auth/session-cookie-expired" ||
      code === "auth/invalid-session-cookie" ||
      code === "auth/session-cookie-revoked"
    ) {
      return null;
    }
    throw error;
  }
}
