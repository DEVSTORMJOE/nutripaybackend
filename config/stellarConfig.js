const StellarSdk = require('stellar-sdk');
require('dotenv').config();

function getEnv(key, defaultValue = "") {
  const val = process.env[key];
  if (!val) return defaultValue;
  return val.replace(/['"]/g, "").trim();
}

const STELLAR_NETWORK = getEnv('STELLAR_NETWORK', 'testnet').toLowerCase();
const IS_MAINNET = STELLAR_NETWORK === 'mainnet';
const IS_TESTNET = !IS_MAINNET;

const HORIZON_URL = getEnv(
  'HORIZON_URL',
  IS_MAINNET ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org'
);

const NETWORK_PASSPHRASE = getEnv(
  'NETWORK_PASSPHRASE',
  IS_MAINNET ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET
);

const FRIENDBOT_URL = getEnv('STELLAR_FRIENDBOT_URL', 'https://friendbot.stellar.org');

const server = new StellarSdk.Horizon.Server(HORIZON_URL);

module.exports = {
  STELLAR_NETWORK,
  IS_MAINNET,
  IS_TESTNET,
  HORIZON_URL,
  NETWORK_PASSPHRASE,
  FRIENDBOT_URL,
  server,
  getEnv
};
