import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getRequestUser } from "@/lib/auth/session";
import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";
import { callDocumentGas } from "@/lib/gas/documents";

const MAX_FILE_SIZE = 3 * 1024 * 1024;
const MAX_REQUEST_SIZE = 4_400_000;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

type UploadRequest = {
  name?: unknown;
  mimeType?: unknown;
  base64?: unknown;
};

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_SIZE) {
    return NextResponse.json({ error: "Document exceeds the 3 MB limit." }, { status: 413 });
  }

  let user;
  try {
    user = await getRequestUser(request);
  } catch (error) {
    console.error("Document upload authentication failed:", error);
    return NextResponse.json({ error: "Server authentication is not configured." }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Please sign in before uploading." }, { status: 401 });
  }

  let body: UploadRequest;
  try {
    body = (await request.json()) as UploadRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (
    typeof body.name !== "string" ||
    !body.name.trim() ||
    body.name.length > 180 ||
    typeof body.mimeType !== "string" ||
    !ALLOWED_MIME_TYPES.has(body.mimeType) ||
    typeof body.base64 !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64) ||
    body.base64.length % 4 !== 0
  ) {
    return NextResponse.json({ error: "Invalid document details." }, { status: 400 });
  }

  if (body.base64.length > 4_200_000) {
    return NextResponse.json({ error: "Document exceeds the 3 MB limit." }, { status: 413 });
  }

  const fileBuffer = Buffer.from(body.base64, "base64");
  if (!fileBuffer.length || fileBuffer.length > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "Document exceeds the 3 MB limit." }, { status: 413 });
  }

  let driveFileId: string | undefined;
  try {
    const gasResult = await callDocumentGas({
      action: "upload",
      name: body.name.trim(),
      mimeType: body.mimeType,
      base64: body.base64,
    });
    if (!gasResult.ok || !gasResult.fileId) {
      throw new Error(gasResult.error ?? "Google Drive upload failed.");
    }
    driveFileId = gasResult.fileId;

    const document = await getFirebaseAdminFirestore()
      .collection("documents")
      .add({
        ownerUid: user.uid,
        fileName: body.name.trim(),
        mimeType: body.mimeType,
        driveFileId,
        status: "stored",
        createdAt: FieldValue.serverTimestamp(),
      });

    return NextResponse.json({ ok: true, documentId: document.id });
  } catch (error) {
    if (driveFileId) {
      try {
        const cleanup = await callDocumentGas({ action: "delete", fileId: driveFileId });
        if (!cleanup.ok) {
          console.error("Could not clean up an orphaned Drive document:", cleanup.error);
        }
      } catch (cleanupError) {
        console.error("Could not clean up an orphaned Drive document:", cleanupError);
      }
    }
    console.error("Document upload failed:", error);
    return NextResponse.json(
      { error: "Document upload failed. Check the server integration settings." },
      { status: 502 },
    );
  }
}
