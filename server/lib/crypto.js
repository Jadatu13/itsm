/**
 * AES-256-GCM encrypt / decrypt for sensitive settings values (e.g. SMTP password).
 *
 * Requires ENCRYPTION_KEY env var — a 64-char hex string (32 bytes).
 * Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * If ENCRYPTION_KEY is not set the value is stored with a plain: prefix so
 * the app still works, but a warning is logged on startup.
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

let _key = null;
let _warned = false;

function getKey() {
  if (_key) return _key;

  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length < 64) {
    if (!_warned) {
      console.warn(
        '[crypto] ENCRYPTION_KEY not set or too short — sensitive settings will be ' +
        'stored without encryption. Set a 64-char hex key in your environment to fix this.\n' +
        '  Generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
      );
      _warned = true;
    }
    return null;
  }

  _key = Buffer.from(hex.slice(0, 64), 'hex');
  return _key;
}

/**
 * Encrypt a plain-text string. Returns a hex string in the format:
 *   enc:<iv_hex>:<tag_hex>:<ciphertext_hex>
 * If no key is configured, returns:
 *   plain:<text>
 */
function encrypt(text) {
  if (!text) return null;

  const key = getKey();
  if (!key) return `plain:${text}`;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a value produced by encrypt(). Returns the original plain-text string,
 * or null if decryption fails or the input is null/empty.
 */
function decrypt(stored) {
  if (!stored) return null;

  if (stored.startsWith('plain:')) return stored.slice(6);

  if (!stored.startsWith('enc:')) return stored; // legacy / unrecognised — return as-is

  try {
    const [, ivHex, tagHex, encHex] = stored.split(':');
    const key = getKey();
    if (!key) return null;

    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null; // wrong key, corrupted data, etc.
  }
}

module.exports = { encrypt, decrypt };
