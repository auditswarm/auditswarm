import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a hex string: iv + authTag + ciphertext
 */
export function encrypt(plaintext: string, encryptionKey: string): string {
  const key = Buffer.from(encryptionKey, 'hex');
  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (64 hex chars)');
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return iv.toString('hex') + authTag.toString('hex') + encrypted;
}

/**
 * Decrypt a hex string encrypted with encrypt().
 */
export function decrypt(encryptedHex: string, encryptionKey: string): string {
  const key = Buffer.from(encryptionKey, 'hex');
  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (64 hex chars)');
  }

  const iv = Buffer.from(encryptedHex.slice(0, IV_LENGTH * 2), 'hex');
  const authTag = Buffer.from(encryptedHex.slice(IV_LENGTH * 2, (IV_LENGTH + TAG_LENGTH) * 2), 'hex');
  const ciphertext = encryptedHex.slice((IV_LENGTH + TAG_LENGTH) * 2);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Generate a random 256-bit key as hex string.
 * Use once to create EXCHANGE_ENCRYPTION_KEY env var.
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('hex');
}
