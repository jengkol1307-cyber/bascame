import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/session";
import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });

  try {
    const snapshot = await getFirebaseAdminFirestore()
      .collection("documents")
      .where("ownerUid", "==", user.uid)
      .limit(100)
      .get();
    const documents = snapshot.docs
      .map((document) => {
        const data = document.data();
        const createdAt = data.createdAt?.toDate?.();
        return {
          id: document.id,
          fileName: data.fileName,
          mimeType: data.mimeType,
          status: data.status,
          createdAt: createdAt instanceof Date ? createdAt.toISOString() : null,
        };
      })
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    return NextResponse.json({ documents });
  } catch (error) {
    console.error("Could not load personal documents:", error);
    return NextResponse.json({ error: "Dokumen belum dapat dimuat." }, { status: 500 });
  }
}
