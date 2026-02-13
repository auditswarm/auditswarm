export interface PaymentConfig {
  payTo: string;
  amount: string;
  currency: string;
  network: string;
  resource: string;
  resourceId?: string;
  description?: string;
  expiresIn?: number; // seconds
}

export interface PaymentHeader {
  version: string;
  scheme: string;
  network: string;
  payload: string;
}

export interface PaymentPayload {
  payTo: string;
  amount: string;
  currency: string;
  signature: string;
  timestamp: number;
  nonce: string;
}

export interface PaymentVerification {
  valid: boolean;
  payerAddress?: string;
  amount?: string;
  currency?: string;
  signature?: string;
  error?: string;
}

export interface X402Response {
  error: 'payment_required';
  code: 402;
  message: string;
  instructions: PaymentInstructions;
}

export interface PaymentInstructions {
  version: '1';
  payTo: string;
  amount: string;
  currency: string;
  network: string;
  networkId?: string;
  resource: string;
  resourceId?: string;
  description?: string;
  validUntil: number;
  nonce: string;
  facilitator?: string;
}

export interface X402Config {
  enabled: boolean;
  facilitatorUrl?: string;
  payToAddress: string;
  network: 'solana:mainnet' | 'solana:devnet';
  defaultCurrency: string;
}

// Pricing configuration
export interface PricingTier {
  resource: string;
  amount: string;
  currency: string;
  description: string;
}

export const PRICING: Record<string, PricingTier> = {
  'audit:basic': {
    resource: 'audit',
    amount: '0.001',
    currency: 'SOL',
    description: 'Basic audit for single wallet',
  },
  'audit:standard': {
    resource: 'audit',
    amount: '0.001',
    currency: 'SOL',
    description: 'Standard audit with full report',
  },
  'audit:premium': {
    resource: 'audit',
    amount: '0.001',
    currency: 'SOL',
    description: 'Premium audit with attestation',
  },
  'compliance:check': {
    resource: 'compliance',
    amount: '0.0005',
    currency: 'SOL',
    description: 'Quick compliance check',
  },
  'report:pdf': {
    resource: 'report',
    amount: '0.0002',
    currency: 'SOL',
    description: 'PDF report generation',
  },
  'attestation:create': {
    resource: 'attestation',
    amount: '0.0025',
    currency: 'SOL',
    description: 'On-chain attestation creation',
  },
};
