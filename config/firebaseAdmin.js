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
    console.warn(`Firebase service account file not found at: ${absolutePath}`);
    console.warn("Firebase Auth will not work until this file is provided.");
    return null;
  }

  const serviceAccount = require(absolutePath);

  if (!serviceAccount.project_id) {
    console.warn("Firebase service account is missing project_id.");
    return null;
  }

  if (!serviceAccount.client_email) {
    console.warn("Firebase service account is missing client_email.");
    return null;
  }

  if (!serviceAccount.private_key) {
    console.warn("Firebase service account is missing private_key.");
    return null;
  }

  return serviceAccount;
}

if (!admin.apps.length) {
  const serviceAccount = loadServiceAccount();

  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });

    console.log("Firebase Admin initialized:", {
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email,
    });
  } else {
    console.warn("Firebase Admin was not initialized due to missing credentials.");
    // Provide a mock auth function to avoid crashing when it is destructured
    admin.auth = () => ({
      verifyIdToken: async () => {
        throw new Error("Firebase Admin not initialized.");
      }
    });
  }
}

module.exports = admin;