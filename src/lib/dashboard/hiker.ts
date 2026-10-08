import "server-only";
import { redirect } from "next/navigation";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getSessionUser } from "@/lib/auth/session";
import { getDashboardPath, getUserRole } from "@/lib/auth/roles";

export async function requireHiker(): Promise<DecodedIdToken> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const role = getUserRole(user);
  if (role !== "user") redirect(getDashboardPath(user));
  return user;
}
