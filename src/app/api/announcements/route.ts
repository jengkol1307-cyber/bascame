import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/session";
import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });

  try {
    const snapshot = await getFirebaseAdminFirestore()
      .collection("announcements")
      .where("visibility", "==", "public")
      .limit(50)
      .get();
    const announcements = snapshot.docs.map((document) => {
      const data = document.data();
      return {
        id: document.id,
        title: typeof data.title === "string" ? data.title : "Informasi basecamp",
        body: typeof data.body === "string" ? data.body : "",
        basecampName: typeof data.basecampName === "string" ? data.basecampName : "Pengumuman resmi",
        category: typeof data.category === "string" ? data.category : "Informasi",
      };
    });
    return NextResponse.json({ announcements });
  } catch (error) {
    console.error("Could not load public announcements:", error);
    return NextResponse.json(
      { error: "Pengumuman belum dapat dimuat." },
      { status: 500 },
    );
  }
}
