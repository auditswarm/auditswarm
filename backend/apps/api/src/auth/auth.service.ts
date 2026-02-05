import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRepository, WalletRepository } from '@auditswarm/database';
import { SiwsService } from './siws.service';
import type { User } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  walletAddress?: string;
  email?: string;
  iat?: number;
  exp?: number;
}

export interface AuthResponse {
  accessToken: string;
  user: {
    id: string;
    email?: string;
    name?: string;
    walletAddress?: string;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private jwtService: JwtService,
    private userRepository: UserRepository,
    private walletRepository: WalletRepository,
    private siwsService: SiwsService,
  ) {}

  /**
   * Sign in with Solana wallet
   */
  async signInWithSolana(
    walletAddress: string,
    signature: string,
    message: string,
    nonce: string,
  ): Promise<AuthResponse> {
    // Verify the signature
    const isValid = await this.siwsService.verify(walletAddress, signature, message, nonce);
    if (!isValid) {
      throw new UnauthorizedException('Invalid signature');
    }

    // Find or create user
    let user = await this.userRepository.findByWalletAddress(walletAddress);

    if (!user) {
      // Create new user
      user = await this.userRepository.create({});

      // Create wallet for user
      await this.walletRepository.create({
        user: { connect: { id: user.id } },
        address: walletAddress,
        network: 'solana',
        label: 'Primary Wallet',
      });

      this.logger.log(`New user created with wallet: ${walletAddress}`);
    }

    // Update last login
    await this.userRepository.updateLastLogin(user.id);

    // Generate JWT
    const payload: JwtPayload = {
      sub: user.id,
      walletAddress,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email ?? undefined,
        name: user.name ?? undefined,
        walletAddress,
      },
    };
  }

  /**
   * Generate a nonce for SIWS
   */
  async generateNonce(walletAddress: string): Promise<{ nonce: string; message: string }> {
    return this.siwsService.createChallenge(walletAddress);
  }

  /**
   * Validate JWT and return user
   */
  async validateUser(payload: JwtPayload): Promise<User | null> {
    return this.userRepository.findById(payload.sub);
  }

  /**
   * Get current user from JWT
   */
  async getCurrentUser(userId: string): Promise<User | null> {
    return this.userRepository.findWithWallets(userId);
  }

  /**
   * Sign in with magic link (email)
   */
  async requestMagicLink(email: string): Promise<{ message: string }> {
    // In production, this would:
    // 1. Generate a one-time token
    // 2. Send email with magic link
    // 3. Return success message

    this.logger.log(`Magic link requested for: ${email}`);

    return {
      message: 'If this email is registered, you will receive a login link.',
    };
  }

  /**
   * Verify magic link token
   */
  async verifyMagicLink(token: string): Promise<AuthResponse> {
    // In production, validate the token and create session
    throw new UnauthorizedException('Magic link authentication not implemented');
  }
}
