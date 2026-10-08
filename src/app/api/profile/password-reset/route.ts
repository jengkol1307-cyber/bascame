import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";

export async function POST() {
  const user = await getSessionUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Sesi akun tidak valid." }, { status: 401 });
  }

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    console.error("Password reset unavailable: Firebase client API key is missing.");
    return NextResponse.json({ error: "Layanan pemulihan sandi belum dikonfigurasi." }, { status: 500 });
  }

  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestType: "PASSWORD_RESET", email: user.email }),
        cache: "no-store",
      },
    );
    if (!response.ok) {
      const result = (await response.json()) as { error?: { message?: string } };
      console.error("Firebase password reset request failed:", result.error?.message);
      return NextResponse.json(
        { error: "Tautan pemulihan sandi belum dapat dikirim." },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Could not request Firebase password reset:", error);
    return NextResponse.json(
      { error: "Tautan pemulihan sandi belum dapat dikirim." },
      { status: 502 },
    );
  }
}
