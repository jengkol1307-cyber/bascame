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

export async function getRequestUser(request: Request): Promise<DecodedIdToken | null> {
  const authorization = request.headers.get("authorization");
  if (authorization === null) return getSessionUser();

  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match) return null;

  try {
    return await getFirebaseAdminAuth().verifyIdToken(match[1], true);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (
      code === "auth/argument-error" ||
      code === "auth/id-token-expired" ||
      code === "auth/invalid-id-token" ||
      code === "auth/id-token-revoked" ||
      code === "auth/user-disabled"
    ) {
      return null;
    }
    throw error;
  }
}
