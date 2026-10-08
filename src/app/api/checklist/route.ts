import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getRequestUser } from "@/lib/auth/session";
import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";

type ChecklistItem = {
  id: string;
  title: string;
  category: string;
  done: boolean;
};

async function getChecklistCollection(uid: string) {
  return getFirebaseAdminFirestore()
    .collection("users")
    .doc(uid)
    .collection("checklist");
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });

  try {
    const snapshot = await (await getChecklistCollection(user.uid)).limit(200).get();
    const items: ChecklistItem[] = snapshot.docs
      .map((document) => {
        const data = document.data();
        return {
          id: document.id,
          title: typeof data.title === "string" ? data.title : "",
          category: typeof data.category === "string" ? data.category : "Perlengkapan",
          done: data.done === true,
        };
      })
      .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Could not load personal checklist:", error);
    return NextResponse.json({ error: "Checklist belum dapat dimuat." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  let body: { title?: unknown; category?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }
  if (
    typeof body.title !== "string" ||
    body.title.trim().length < 2 ||
    body.title.trim().length > 100 ||
    typeof body.category !== "string" ||
    !["Perlengkapan", "Dokumen", "Kesehatan", "Perjalanan"].includes(body.category)
  ) {
    return NextResponse.json({ error: "Isi checklist tidak valid." }, { status: 400 });
  }

  try {
    const item = await (await getChecklistCollection(user.uid)).add({
      title: body.title.trim(),
      category: body.category,
      done: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json(
      { item: { id: item.id, title: body.title.trim(), category: body.category, done: false } },
      { status: 201 },
    );
  } catch (error) {
    console.error("Could not add checklist item:", error);
    return NextResponse.json({ error: "Item checklist belum dapat disimpan." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  let body: { id?: unknown; done?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }
  if (typeof body.id !== "string" || typeof body.done !== "boolean") {
    return NextResponse.json({ error: "Status checklist tidak valid." }, { status: 400 });
  }

  try {
    const ref = (await getChecklistCollection(user.uid)).doc(body.id);
    const snapshot = await ref.get();
    if (!snapshot.exists) return NextResponse.json({ error: "Item tidak ditemukan." }, { status: 404 });
    await ref.update({ done: body.done, updatedAt: FieldValue.serverTimestamp() });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Could not update checklist item:", error);
    return NextResponse.json({ error: "Status checklist belum dapat diperbarui." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  let body: { id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }
  if (typeof body.id !== "string") {
    return NextResponse.json({ error: "Item checklist tidak valid." }, { status: 400 });
  }

  try {
    const ref = (await getChecklistCollection(user.uid)).doc(body.id);
    const snapshot = await ref.get();
    if (!snapshot.exists) return NextResponse.json({ error: "Item tidak ditemukan." }, { status: 404 });
    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Could not delete checklist item:", error);
    return NextResponse.json({ error: "Item checklist belum dapat dihapus." }, { status: 500 });
  }
}
