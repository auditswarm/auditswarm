import { SetMetadata } from '@nestjs/common';

export const PAYMENT_REQUIRED_KEY = 'payment_required';

export interface PaymentRequiredOptions {
  resource: string;
  amount: string;
  currency?: string;
  network?: string;
  payTo?: string;
  description?: string;
}

/**
 * Decorator to mark an endpoint as requiring payment via x402
 *
 * @example
 * @PaymentRequired({
 *   resource: 'audit',
 *   amount: '0.10',
 *   description: 'Basic audit'
 * })
 * @Post('audits')
 * createAudit() { ... }
 */
export const PaymentRequired = (options: PaymentRequiredOptions) =>
  SetMetadata(PAYMENT_REQUIRED_KEY, options);
