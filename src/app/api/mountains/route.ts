import { NextResponse } from "next/server";
import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";

type Mountain = {
  id: string;
  name: string;
  location: string;
  elevation: string;
  status: string;
  description: string;
};

export async function GET() {
  try {
    const snapshot = await getFirebaseAdminFirestore()
      .collection("mountains")
      .where("visibility", "==", "public")
      .limit(100)
      .get();
    const mountains: Mountain[] = snapshot.docs.map((document) => {
      const data = document.data();
      return {
        id: document.id,
        name: typeof data.name === "string" ? data.name : "Gunung",
        location: typeof data.location === "string" ? data.location : "",
        elevation: typeof data.elevation === "string" ? data.elevation : "",
        status: typeof data.status === "string" ? data.status : "Belum dikonfirmasi",
        description: typeof data.description === "string" ? data.description : "",
      };
    });
    return NextResponse.json({ mountains });
  } catch (error) {
    console.error("Could not load public mountains:", error);
    return NextResponse.json(
      { error: "Informasi gunung belum dapat dimuat." },
      { status: 500 },
    );
  }
}
