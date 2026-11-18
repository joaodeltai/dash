import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/* AES-256-GCM. A chave mestra tem 32 bytes em base64 e vive só na variável
   EMAIL_CREDENTIALS_KEY. Ela não entra no banco nem na resposta. */
export function parseKey(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  let buf;
  try {
    buf = Buffer.from(text, 'base64');
  } catch {
    return null;
  }
  if (buf.length !== 32) return null;
  return buf;
}

export function encryptPassword(password, key) {
  if (!key || key.length !== 32) throw Object.assign(new Error('missing_key'), { code: 'missing_key' });
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(String(password), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    nonce: nonce.toString('base64'),
    tag: tag.toString('base64'),
    keyVersion: 1,
  };
}

export function decryptPassword(row, key) {
  if (!key || key.length !== 32) throw Object.assign(new Error('missing_key'), { code: 'missing_key' });
  const nonce = Buffer.from(row.nonce, 'base64');
  const tag = Buffer.from(row.tag, 'base64');
  const data = Buffer.from(row.ciphertext, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return plain;
}

export function secretEquals(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
