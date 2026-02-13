// ─── x402 Payment Protocol (Frontend) ───────────────────────────────

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

export interface X402Response {
  error: 'payment_required';
  code: 402;
  message: string;
  instructions: PaymentInstructions;
}

/** Called by apiFetch when a 402 is received. Returns the tx signature. */
export type PaymentHandler = (instructions: PaymentInstructions) => Promise<string>;

let paymentHandler: PaymentHandler | null = null;

export function registerPaymentHandler(handler: PaymentHandler | null) {
  paymentHandler = handler;
}

export function getPaymentHandler(): PaymentHandler | null {
  return paymentHandler;
}

export function isPaymentRequired(body: unknown): body is X402Response {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as Record<string, unknown>).error === 'payment_required' &&
    (body as Record<string, unknown>).code === 402 &&
    (body as Record<string, unknown>).instructions != null
  );
}

export function buildPaymentHeader(instructions: PaymentInstructions, signature: string): string {
  const payload = {
    payTo: instructions.payTo,
    amount: instructions.amount,
    currency: instructions.currency,
    signature,
    timestamp: Math.floor(Date.now() / 1000),
    nonce: instructions.nonce,
  };
  const encoded = btoa(JSON.stringify(payload));
  const network = instructions.network.includes(':')
    ? instructions.network.split(':')[1]
    : instructions.network;
  return `x402 scheme=solana network=${network} payload=${encoded}`;
}
