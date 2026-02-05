import { createHash } from 'crypto';

/**
 * Hash data using SHA-256
 */
export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Validate a Solana public key format
 */
export function isValidSolanaAddress(address: string): boolean {
  // Base58 characters (excludes 0, O, I, l)
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(address);
}

/**
 * Truncate an address for display
 */
export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Generate a verification hash for audit results
 */
export function generateAuditHash(
  auditId: string,
  walletAddress: string,
  taxYear: number,
  jurisdiction: string,
  summary: object,
): string {
  const data = JSON.stringify({
    auditId,
    walletAddress,
    taxYear,
    jurisdiction,
    summary,
    timestamp: Date.now(),
  });
  return sha256(data);
}

/**
 * Verify a signature message format for SIWS
 */
export function createSIWSMessage(
  domain: string,
  address: string,
  nonce: string,
  issuedAt: Date,
  expiresAt: Date,
): string {
  return `${domain} wants you to sign in with your Solana account:
${address}

Sign in to AuditSwarm

URI: https://${domain}
Version: 1
Chain ID: mainnet
Nonce: ${nonce}
Issued At: ${issuedAt.toISOString()}
Expiration Time: ${expiresAt.toISOString()}`;
}
