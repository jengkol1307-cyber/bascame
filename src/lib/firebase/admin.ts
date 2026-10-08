import "server-only";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabaseWithUrl } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";

function getFirebaseAdminApp() {
  const existingApp = getApps()[0];
  if (existingApp) return existingApp;

  const adminProjectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim();
  const adminClientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
  const adminPrivateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim();
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const hasAnyAdminCredentials =
    Boolean(adminProjectId) || Boolean(adminClientEmail) || Boolean(adminPrivateKey);

  let projectId: string | undefined;
  let clientEmail: string | undefined;
  let privateKey: string | undefined;
  if (hasAnyAdminCredentials) {
    if (!adminProjectId || !adminClientEmail || !adminPrivateKey) {
      throw new Error(
        "Set all three Firebase Admin variables: FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, and FIREBASE_ADMIN_PRIVATE_KEY.",
      );
    }
    projectId = adminProjectId;
    clientEmail = adminClientEmail;
    privateKey = adminPrivateKey;
  } else if (serviceAccountJson) {
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
    projectId =
      process.env.FIREBASE_PROJECT_ID?.trim() ??
      (typeof serviceAccountData.project_id === "string"
        ? serviceAccountData.project_id
        : undefined);
    clientEmail =
      typeof serviceAccountData.client_email === "string"
        ? serviceAccountData.client_email
        : undefined;
    privateKey =
      typeof serviceAccountData.private_key === "string"
        ? serviceAccountData.private_key
        : undefined;
  } else {
    throw new Error(
      "Set all three FIREBASE_ADMIN_* variables or provide FIREBASE_SERVICE_ACCOUNT_JSON for Firebase Admin.",
    );
  }

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin credentials must include a project ID, client email, and private key.",
    );
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, "\n"),
    }),
    projectId,
  });
}

export function getFirebaseAdminAuth() {
  return getAuth(getFirebaseAdminApp());
}

export function getFirebaseAdminFirestore() {
  return getFirestore(getFirebaseAdminApp());
}

export function getFirebaseAdminRealtimeDatabase() {
  const databaseUrl = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("NEXT_PUBLIC_FIREBASE_DATABASE_URL is not configured.");
  }
  return getDatabaseWithUrl(databaseUrl, getFirebaseAdminApp());
}
