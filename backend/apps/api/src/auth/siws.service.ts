import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@auditswarm/database';
import { PublicKey } from '@solana/web3.js';
import * as nacl from 'tweetnacl';
import * as bs58 from 'bs58';
import { randomBytes } from 'crypto';

@Injectable()
export class SiwsService {
  private readonly logger = new Logger(SiwsService.name);
  private readonly domain: string;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.domain = this.configService.get<string>('APP_DOMAIN', 'auditswarm.xyz');
  }

  /**
   * Create a challenge for SIWS
   */
  async createChallenge(walletAddress: string): Promise<{ nonce: string; message: string }> {
    // Generate nonce
    const nonce = randomBytes(32).toString('hex');

    // Calculate expiry (5 minutes)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Store nonce in database
    await this.prisma.nonce.create({
      data: {
        nonce,
        walletAddress,
        expiresAt,
      },
    });

    // Create SIWS message
    const message = this.createMessage(walletAddress, nonce);

    return { nonce, message };
  }

  /**
   * Create SIWS message format
   */
  private createMessage(walletAddress: string, nonce: string): string {
    const now = new Date();
    const expiry = new Date(now.getTime() + 5 * 60 * 1000);

    return `${this.domain} wants you to sign in with your Solana account:
${walletAddress}

Sign in to AuditSwarm - Crypto Compliance Platform

URI: https://${this.domain}
Version: 1
Chain ID: mainnet
Nonce: ${nonce}
Issued At: ${now.toISOString()}
Expiration Time: ${expiry.toISOString()}`;
  }

  /**
   * Verify a SIWS signature
   */
  async verify(
    walletAddress: string,
    signature: string,
    message: string,
    nonce: string,
  ): Promise<boolean> {
    try {
      // Check nonce exists and is valid
      const storedNonce = await this.prisma.nonce.findFirst({
        where: {
          nonce,
          walletAddress,
          expiresAt: { gt: new Date() },
          usedAt: null,
        },
      });

      if (!storedNonce) {
        this.logger.warn(`Invalid or expired nonce for wallet: ${walletAddress}`);
        return false;
      }

      // Verify signature
      const publicKey = new PublicKey(walletAddress);
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = bs58.decode(signature);

      const isValid = nacl.sign.detached.verify(
        messageBytes,
        signatureBytes,
        publicKey.toBytes(),
      );

      if (isValid) {
        // Mark nonce as used
        await this.prisma.nonce.update({
          where: { id: storedNonce.id },
          data: { usedAt: new Date() },
        });
      }

      return isValid;
    } catch (error) {
      this.logger.error(`Signature verification failed: ${error}`);
      return false;
    }
  }

  /**
   * Clean up expired nonces
   */
  async cleanupExpiredNonces(): Promise<number> {
    const result = await this.prisma.nonce.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { usedAt: { not: null } },
        ],
      },
    });
    return result.count;
  }
}
