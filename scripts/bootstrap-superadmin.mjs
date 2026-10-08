import { readFile } from "node:fs/promises";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

async function loadLocalEnvironment() {
  let contents;
  try {
    contents = await readFile(".env.local", "utf8");
  } catch {
    throw new Error("Missing .env.local. Configure local Firebase Admin credentials first.");
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;

    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set in .env.local.`);
  return value;
}

await loadLocalEnvironment();

const projectId = requiredEnvironment("FIREBASE_PROJECT_ID");
const serviceAccountJson = requiredEnvironment("FIREBASE_SERVICE_ACCOUNT_JSON");
const password = requiredEnvironment("SUPERADMIN_PASSWORD");

if (password.length < 6 || password.length > 128) {
  throw new Error("SUPERADMIN_PASSWORD must be between 6 and 128 characters.");
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(serviceAccountJson);
} catch {
  throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must be valid JSON.");
}

if (
  serviceAccount.project_id !== projectId ||
  typeof serviceAccount.client_email !== "string" ||
  typeof serviceAccount.private_key !== "string"
) {
  throw new Error("The service account must match FIREBASE_PROJECT_ID and contain its private key.");
}

const app = initializeApp({
  credential: cert({
    projectId,
    clientEmail: serviceAccount.client_email,
    privateKey: serviceAccount.private_key.replace(/\\n/g, "\n"),
  }),
  projectId,
});
const auth = getAuth(app);
const firestore = getFirestore(app);
const email = "dionyyr@gmail.com";
const username = "superadmin";

let user;
let created = false;
try {
  user = await auth.getUserByEmail(email);
  user = await auth.updateUser(user.uid, {
    displayName: username,
    password,
    emailVerified: false,
    disabled: false,
  });
} catch (error) {
  if (error.code !== "auth/user-not-found") throw error;
  user = await auth.createUser({
    email,
    password,
    displayName: username,
    emailVerified: false,
    disabled: false,
  });
  created = true;
}

await auth.setCustomUserClaims(user.uid, {
  ...user.customClaims,
  role: "superadmin",
  username,
});

await firestore.collection("users").doc(user.uid).set(
  {
    uid: user.uid,
    email,
    username,
    usernameNormalized: username.toLowerCase(),
    role: "superadmin",
    updatedAt: FieldValue.serverTimestamp(),
    ...(created && user.metadata.creationTime
      ? { createdAt: new Date(user.metadata.creationTime) }
      : {}),
  },
  { merge: true },
);

await firestore.collection("usernames").doc(username.toLowerCase()).set(
  {
    uid: user.uid,
    username,
    usernameNormalized: username.toLowerCase(),
    updatedAt: FieldValue.serverTimestamp(),
  },
  { merge: true },
);

console.log(`Superadmin account and Firestore profile are ready for ${email}.`);
