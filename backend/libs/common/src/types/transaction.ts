import { z } from 'zod';

export const TransactionType = z.enum([
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'SWAP',
  'BUY',
  'SELL',
  'MINT',
  'BURN',
  'STAKE',
  'UNSTAKE',
  'REWARD',
  'AIRDROP',
  'NFT_PURCHASE',
  'NFT_SALE',
  'NFT_MINT',
  'LOAN_BORROW',
  'LOAN_REPAY',
  'LP_DEPOSIT',
  'LP_WITHDRAW',
  'BRIDGE_IN',
  'BRIDGE_OUT',
  'FEE',
  'UNKNOWN',
]);
export type TransactionType = z.infer<typeof TransactionType>;

export const TransactionStatus = z.enum(['PENDING', 'CONFIRMED', 'FAILED']);
export type TransactionStatus = z.infer<typeof TransactionStatus>;

export interface Transaction {
  id: string;
  walletId: string;
  signature: string;
  type: TransactionType;
  status: TransactionStatus;
  timestamp: Date;
  slot: number;
  blockTime: number;
  fee: bigint;
  feePayer: string;

  // Token transfers
  transfers: TokenTransfer[];

  // Computed values
  costBasis?: CostBasis;
  gainLoss?: GainLoss;

  // Raw data
  rawData: Record<string, unknown>;
}

export interface TokenTransfer {
  mint: string;
  symbol?: string;
  decimals: number;
  amount: bigint;
  direction: 'IN' | 'OUT';
  from?: string;
  to?: string;
  priceUsd?: number;
  valueUsd?: number;
}

export interface CostBasis {
  method: 'FIFO' | 'LIFO' | 'HIFO' | 'SPECIFIC_ID' | 'AVERAGE';
  amount: number;
  currency: string;
  acquisitionDate?: Date;
  acquisitionTransaction?: string;
}

export interface GainLoss {
  amount: number;
  currency: string;
  type: 'SHORT_TERM' | 'LONG_TERM';
  holdingPeriodDays: number;
}

export const ParsedTransactionSchema = z.object({
  signature: z.string(),
  type: TransactionType,
  timestamp: z.date(),
  transfers: z.array(z.object({
    mint: z.string(),
    symbol: z.string().optional(),
    amount: z.string(),
    direction: z.enum(['IN', 'OUT']),
    valueUsd: z.number().optional(),
  })),
});

export type ParsedTransaction = z.infer<typeof ParsedTransactionSchema>;
