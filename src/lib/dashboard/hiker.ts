import "server-only";
import { redirect } from "next/navigation";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getSessionUser } from "@/lib/auth/session";

export async function requireHiker(): Promise<DecodedIdToken> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "superadmin") redirect("/dashboard/superadmin");
  if (user.role === "admin") redirect("/dashboard/admin");
  return user;
}
