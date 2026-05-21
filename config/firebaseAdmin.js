// backend/config/firebaseAdmin.js
const path = require("path");
const fs = require("fs");
const admin = require("firebase-admin");

function loadServiceAccount() {
  /*
    Best local-development approach:
    - Keep the JSON file in backend/config/firebase-service-account.json
    - Do NOT commit it to GitHub.
    - Optionally override path using FIREBASE_SERVICE_ACCOUNT_PATH.
  */

  const serviceAccountPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.join(__dirname, "firebase-service-account.json");

  const absolutePath = path.isAbsolute(serviceAccountPath)
    ? serviceAccountPath
    : path.resolve(process.cwd(), serviceAccountPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(
      `Firebase service account file not found at: ${absolutePath}`
    );
  }

  const serviceAccount = require(absolutePath);

  if (!serviceAccount.project_id) {
    throw new Error("Firebase service account is missing project_id.");
  }

  if (!serviceAccount.client_email) {
    throw new Error("Firebase service account is missing client_email.");
  }

  if (!serviceAccount.private_key) {
    throw new Error("Firebase service account is missing private_key.");
  }

  return serviceAccount;
}

if (!admin.apps.length) {
  const serviceAccount = loadServiceAccount();

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });

  console.log("Firebase Admin initialized:", {
    projectId: serviceAccount.project_id,
    clientEmail: serviceAccount.client_email,
  });
}

module.exports = admin;