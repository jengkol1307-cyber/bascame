import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/session";
import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";
import { callDocumentGas } from "@/lib/gas/documents";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const user = await getRequestUser(_request);
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  const { documentId } = await context.params;

  try {
    const ref = getFirebaseAdminFirestore().collection("documents").doc(documentId);
    const document = await ref.get();
    if (!document.exists) {
      return NextResponse.json({ error: "Dokumen tidak ditemukan." }, { status: 404 });
    }

    const metadata = document.data();
    const isAdmin = user.role === "admin" || user.role === "superadmin";
    if (!isAdmin && metadata?.ownerUid !== user.uid) {
      return NextResponse.json({ error: "Anda tidak memiliki akses ke dokumen ini." }, { status: 403 });
    }
    if (
      typeof metadata?.driveFileId !== "string" ||
      typeof metadata?.mimeType !== "string" ||
      !["application/pdf", "image/jpeg", "image/png"].includes(metadata.mimeType)
    ) {
      return NextResponse.json({ error: "Metadata dokumen tidak valid." }, { status: 500 });
    }

    const gasResult = await callDocumentGas({
      action: "download",
      fileId: metadata.driveFileId,
    });
    if (!gasResult.ok || typeof gasResult.base64 !== "string") {
      throw new Error(gasResult.error ?? "Google Drive download failed.");
    }

    const bytes = Buffer.from(gasResult.base64, "base64");
    if (!bytes.length || bytes.length > 3 * 1024 * 1024) {
      throw new Error("Stored document has an invalid size.");
    }
    const fileName =
      typeof metadata.fileName === "string" ? metadata.fileName : "dokumen";
    const response = new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": metadata.mimeType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
    return response;
  } catch (error) {
    console.error("Could not retrieve private Drive document:", error);
    return NextResponse.json({ error: "Dokumen belum dapat diunduh." }, { status: 502 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const user = await getRequestUser(_request);
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  const { documentId } = await context.params;

  try {
    const firestore = getFirebaseAdminFirestore();
    const ref = firestore.collection("documents").doc(documentId);
    const document = await ref.get();
    if (!document.exists) {
      return NextResponse.json({ error: "Dokumen tidak ditemukan." }, { status: 404 });
    }

    const metadata = document.data();
    if (metadata?.ownerUid !== user.uid || typeof metadata.driveFileId !== "string") {
      return NextResponse.json({ error: "Anda tidak memiliki akses ke dokumen ini." }, { status: 403 });
    }

    const gasResult = await callDocumentGas({
      action: "delete",
      fileId: metadata.driveFileId,
    });
    if (!gasResult.ok) {
      throw new Error(gasResult.error ?? "Google Drive deletion failed.");
    }
    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Could not delete private Drive document:", error);
    return NextResponse.json({ error: "Dokumen belum dapat dihapus." }, { status: 502 });
  }
}
