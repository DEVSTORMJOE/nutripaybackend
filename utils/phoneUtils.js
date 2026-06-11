// utils/phoneUtils.js

/**
 * Normalize Kenyan numbers to 2547XXXXXXXX or 2541XXXXXXXX format (12 digits, no +)
 * @param {String|Number} input 
 * @returns {String}
 */
function normalizePhone(input) {
  if (!input) return "";
  let clean = String(input).replace(/\D/g, "");
  if (clean.startsWith("2540")) {
    clean = "254" + clean.slice(4);
  } else if (clean.startsWith("0")) {
    clean = "254" + clean.slice(1);
  } else if (clean.length === 9) {
    clean = "254" + clean;
  }
  return clean;
}

/**
 * Validate normalized Kenyan phone number format
 * @param {String|Number} input 
 * @returns {Boolean}
 */
function isValidPhone(input) {
  const normalized = normalizePhone(input);
  return /^254(7|1)\d{8}$/.test(normalized);
}

module.exports = {
  normalizePhone,
  isValidPhone
};
