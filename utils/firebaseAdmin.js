/**
 * Firebase Admin SDK — verifies phone-auth ID tokens from web/mobile clients.
 * firebase-admin v14: use admin.cert() and getAuth() (not admin.credential / admin.auth).
 */
const admin = require("firebase-admin");
const { getAuth } = require("firebase-admin/auth");

let initialized = false;

function getFirebaseAdmin() {
  if (initialized) return admin;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKeyRaw) {
    throw new Error(
      "Firebase Admin is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.",
    );
  }

  let privateKey = String(privateKeyRaw).trim();
  if (
    (privateKey.startsWith('"') && privateKey.endsWith('"')) ||
    (privateKey.startsWith("'") && privateKey.endsWith("'"))
  ) {
    privateKey = privateKey.slice(1, -1);
  }
  privateKey = privateKey.replace(/\\n/g, "\n");

  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new Error("FIREBASE_PRIVATE_KEY is malformed.");
  }

  admin.initializeApp({
    credential: admin.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });

  initialized = true;
  return admin;
}

/** Auth service for the default Firebase Admin app. */
function getFirebaseAuth() {
  getFirebaseAdmin();
  return getAuth();
}

function isFirebaseAdminConfigured() {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY,
  );
}

module.exports = { getFirebaseAdmin, getFirebaseAuth, isFirebaseAdminConfigured };
