"use client";

import { signOut as firebaseSignOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { getFirebaseAuth } from "@/lib/firebase/client";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    try {
      await signOutFirebaseUser();
    } catch (error) {
      console.error("Could not clear Firebase client session:", error);
    }
    await fetch("/api/auth/session", { method: "DELETE" });
    router.replace("/login");
  }

  return (
    <button className="signout-button" onClick={handleSignOut}>
      Keluar
    </button>
  );
}

async function signOutFirebaseUser() {
  await firebaseSignOut(getFirebaseAuth());
}
