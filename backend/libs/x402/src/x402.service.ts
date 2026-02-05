import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import type {
  PaymentConfig,
  PaymentHeader,
  PaymentPayload,
  PaymentVerification,
  PaymentInstructions,
  X402Config,
} from './types';

@Injectable()
export class X402Service {
  private readonly logger = new Logger(X402Service.name);
  private readonly config: X402Config;

  constructor(private configService: ConfigService) {
    this.config = {
      enabled: this.configService.get<boolean>('X402_ENABLED', false),
      facilitatorUrl: this.configService.get<string>('X402_FACILITATOR_URL'),
      payToAddress: this.configService.get<string>('X402_PAY_TO_ADDRESS', ''),
      network: this.configService.get<'solana:mainnet' | 'solana:devnet'>(
        'X402_NETWORK',
        'solana:devnet',
      ),
      defaultCurrency: this.configService.get<string>('X402_CURRENCY', 'USDC'),
    };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Create payment instructions for a 402 response
   */
  createPaymentInstructions(config: PaymentConfig): PaymentInstructions {
    const nonce = randomBytes(16).toString('hex');
    const validUntil = Math.floor(Date.now() / 1000) + (config.expiresIn ?? 300);

    return {
      version: '1',
      payTo: config.payTo || this.config.payToAddress,
      amount: config.amount,
      currency: config.currency || this.config.defaultCurrency,
      network: config.network || this.config.network,
      resource: config.resource,
      resourceId: config.resourceId,
      description: config.description,
      validUntil,
      nonce,
      facilitator: this.config.facilitatorUrl,
    };
  }

  /**
   * Parse the PAYMENT header from a request
   */
  parsePaymentHeader(headerValue: string): PaymentHeader | null {
    try {
      // Format: x402 scheme=solana network=mainnet payload=base64...
      const parts = headerValue.split(' ');
      if (parts[0] !== 'x402') {
        return null;
      }

      const header: Partial<PaymentHeader> = { version: '1' };
      for (let i = 1; i < parts.length; i++) {
        const [key, value] = parts[i].split('=');
        if (key === 'scheme') header.scheme = value;
        else if (key === 'network') header.network = value;
        else if (key === 'payload') header.payload = value;
      }

      if (!header.scheme || !header.network || !header.payload) {
        return null;
      }

      return header as PaymentHeader;
    } catch (error) {
      this.logger.error('Failed to parse payment header', error);
      return null;
    }
  }

  /**
   * Decode and parse the payment payload
   */
  parsePaymentPayload(base64Payload: string): PaymentPayload | null {
    try {
      const decoded = Buffer.from(base64Payload, 'base64').toString('utf-8');
      const payload = JSON.parse(decoded) as PaymentPayload;

      // Validate required fields
      if (!payload.payTo || !payload.amount || !payload.signature) {
        return null;
      }

      return payload;
    } catch (error) {
      this.logger.error('Failed to parse payment payload', error);
      return null;
    }
  }

  /**
   * Verify a payment
   */
  async verifyPayment(
    header: PaymentHeader,
    expectedAmount: string,
    expectedCurrency: string,
  ): Promise<PaymentVerification> {
    try {
      const payload = this.parsePaymentPayload(header.payload);
      if (!payload) {
        return { valid: false, error: 'Invalid payment payload' };
      }

      // Check amount
      if (parseFloat(payload.amount) < parseFloat(expectedAmount)) {
        return { valid: false, error: 'Insufficient payment amount' };
      }

      // Check timestamp (not too old)
      const now = Math.floor(Date.now() / 1000);
      if (now - payload.timestamp > 300) {
        return { valid: false, error: 'Payment expired' };
      }

      // If facilitator is configured, verify with facilitator
      if (this.config.facilitatorUrl) {
        const verified = await this.verifyWithFacilitator(header, payload);
        if (!verified.valid) {
          return verified;
        }
      }

      // For now, trust the signature (in production, verify on-chain)
      return {
        valid: true,
        payerAddress: payload.payTo,
        amount: payload.amount,
        currency: expectedCurrency,
        signature: payload.signature,
      };
    } catch (error) {
      this.logger.error('Payment verification failed', error);
      return { valid: false, error: 'Verification failed' };
    }
  }

  /**
   * Verify payment with x402 facilitator
   */
  private async verifyWithFacilitator(
    header: PaymentHeader,
    payload: PaymentPayload,
  ): Promise<PaymentVerification> {
    try {
      const response = await fetch(`${this.config.facilitatorUrl}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          network: header.network,
          signature: payload.signature,
          payTo: payload.payTo,
          amount: payload.amount,
        }),
      });

      if (!response.ok) {
        return { valid: false, error: 'Facilitator verification failed' };
      }

      const result = await response.json();
      return {
        valid: result.verified === true,
        error: result.error,
      };
    } catch (error) {
      this.logger.error('Facilitator verification error', error);
      return { valid: false, error: 'Facilitator unavailable' };
    }
  }

  /**
   * Settle a payment (record it as completed)
   */
  async settlePayment(
    payerAddress: string,
    signature: string,
    resource: string,
    resourceId: string,
  ): Promise<void> {
    // In production, this would:
    // 1. Record the payment in database
    // 2. Potentially notify the facilitator
    // 3. Emit events for analytics
    this.logger.log(
      `Payment settled: ${payerAddress} -> ${resource}/${resourceId} (${signature})`,
    );
  }
}
