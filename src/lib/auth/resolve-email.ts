import "server-only";
import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";

export async function resolveEmail(identifier: string): Promise<string | null> {
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
      const indexedEmail = await firestore.collection("users").doc(uid).get()
        .then((profile) => profile.get("email"));
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
