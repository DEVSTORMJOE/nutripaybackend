// config/firebaseAdmin.js
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp(); // uses GOOGLE_APPLICATION_CREDENTIALS or metadata
}

module.exports = admin;