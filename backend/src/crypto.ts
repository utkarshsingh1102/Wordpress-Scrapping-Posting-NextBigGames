import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

const KEY_FILE = path.resolve(process.cwd(), '.cred-key');

let cachedKey: Buffer | null = null;

export function getKey(envKey: string | undefined): Buffer {
  if (cachedKey) return cachedKey;
  if (envKey) {
    const buf = Buffer.from(envKey, 'hex');
    if (buf.length !== KEY_LEN) {
      throw new Error(
        'CRED_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)',
      );
    }
    cachedKey = buf;
    return buf;
  }
  if (fs.existsSync(KEY_FILE)) {
    const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
    const buf = Buffer.from(hex, 'hex');
    if (buf.length === KEY_LEN) {
      cachedKey = buf;
      return buf;
    }
    throw new Error(`Corrupt key in ${KEY_FILE}`);
  }
  const buf = crypto.randomBytes(KEY_LEN);
  fs.writeFileSync(KEY_FILE, buf.toString('hex'), { mode: 0o600 });
  console.warn(
    `[crypto] CRED_ENCRYPTION_KEY not set; generated and saved to ${KEY_FILE}. Add to .env to make portable.`,
  );
  cachedKey = buf;
  return buf;
}

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decrypt(payload: string, key: Buffer): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
