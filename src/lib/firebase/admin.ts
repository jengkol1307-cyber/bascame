import "server-only";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function getFirebaseAdminApp() {
  const existingApp = getApps()[0];
  if (existingApp) return existingApp;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJson) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is required for Firebase Admin.",
    );
  }

  let parsedServiceAccount: unknown;
  try {
    parsedServiceAccount = JSON.parse(serviceAccountJson) as unknown;
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid JSON.");
  }

  if (
    typeof parsedServiceAccount !== "object" ||
    parsedServiceAccount === null ||
    Array.isArray(parsedServiceAccount)
  ) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain a JSON object.");
  }
  const serviceAccountData = parsedServiceAccount as Record<string, unknown>;

  const projectId =
    process.env.FIREBASE_PROJECT_ID ??
    (typeof serviceAccountData.project_id === "string"
      ? serviceAccountData.project_id
      : undefined);
  const clientEmail =
    typeof serviceAccountData.client_email === "string"
      ? serviceAccountData.client_email
      : undefined;
  const privateKey =
    typeof serviceAccountData.private_key === "string"
      ? serviceAccountData.private_key.replace(/\\n/g, "\n")
      : undefined;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON must include project_id, client_email, and private_key.",
    );
  }

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  });
}

export function getFirebaseAdminAuth() {
  return getAuth(getFirebaseAdminApp());
}

export function getFirebaseAdminFirestore() {
  return getFirestore(getFirebaseAdminApp());
}
