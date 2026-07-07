// config/jwtKeys.js
const dotenv = require("dotenv");
dotenv.config();

const keys = {
  v1: process.env.JWT_SECRET_V1 || process.env.JWT_SECRET || "nutripaysecret123",
  v2: process.env.JWT_SECRET_V2 || "nutripaysecret456_secure_key_v2"
};

const currentKeyId = process.env.JWT_CURRENT_KEY_ID || "v1";

module.exports = {
  keys,
  currentKeyId,
  
  // Get secret for a given kid, falling back to legacy JWT_SECRET if kid not found
  getSecret(kid) {
    if (kid && keys[kid]) {
      return keys[kid];
    }
    return process.env.JWT_SECRET || keys.v1 || "nutripaysecret123";
  },

  // Get the currently active secret
  getCurrentSecret() {
    return this.getSecret(currentKeyId);
  }
};
