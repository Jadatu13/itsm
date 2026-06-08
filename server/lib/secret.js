/**
 * Centralised JWT secret + helpers.
 *
 * Single source of truth for the signing secret. There is NO hardcoded
 * fallback secret — that would let anyone with the source forge admin tokens.
 *
 *  - Production (NODE_ENV=production): JWT_SECRET is mandatory and must be
 *    reasonably strong (>= 32 chars). The process refuses to start otherwise.
 *  - Development: if unset, a random ephemeral secret is generated so local
 *    dev still runs. Tokens won't survive a restart, which is fine for dev.
 *
 * Generate a strong secret:
 *   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const MIN_LENGTH = 32;
const ALGORITHMS = ['HS256'];

let JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < MIN_LENGTH) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[FATAL] JWT_SECRET is missing or too short. Set a strong (>= 32 char) ' +
      'random value in the environment before starting in production.\n' +
      '  Generate one: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
  }
  JWT_SECRET = crypto.randomBytes(48).toString('hex');
  console.warn(
    '[secret] JWT_SECRET not set — using a random ephemeral dev secret. ' +
    'Sessions will not survive a restart. Set JWT_SECRET for stable sessions.'
  );
}

/** Sign a payload with the shared secret. */
function sign(payload, options = {}) {
  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', ...options });
}

/** Verify a token, pinning the algorithm to prevent algorithm-confusion attacks. */
function verify(token, options = {}) {
  return jwt.verify(token, JWT_SECRET, { algorithms: ALGORITHMS, ...options });
}

module.exports = { JWT_SECRET, sign, verify, ALGORITHMS };
