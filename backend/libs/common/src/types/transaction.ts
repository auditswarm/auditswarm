import { z } from 'zod';

export const TransactionType = z.enum([
  // On-chain types
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
  'PROGRAM_INTERACTION',
  'UNKNOWN',

  // Exchange Trading
  'EXCHANGE_TRADE',       // spot trade (buy/sell)
  'EXCHANGE_C2C_TRADE',   // P2P trade

  // Exchange Transfers
  'EXCHANGE_DEPOSIT',     // crypto deposited into exchange
  'EXCHANGE_WITHDRAWAL',  // crypto withdrawn from exchange
  'EXCHANGE_FIAT_BUY',    // fiat → crypto purchase
  'EXCHANGE_FIAT_SELL',   // crypto → fiat sale

  // Exchange Earn/Staking
  'EXCHANGE_STAKE',       // staking subscription
  'EXCHANGE_UNSTAKE',     // staking redemption
  'EXCHANGE_INTEREST',    // earn/staking rewards
  'EXCHANGE_DIVIDEND',    // dividend/airdrop from exchange

  // Exchange Operations
  'EXCHANGE_DUST_CONVERT', // dust-to-BNB conversion
  'EXCHANGE_CONVERT',      // crypto-to-crypto convert (not spot trade)

  // Margin
  'MARGIN_BORROW',        // margin loan
  'MARGIN_REPAY',         // margin loan repayment
  'MARGIN_INTEREST',      // margin interest charge
  'MARGIN_LIQUIDATION',   // forced liquidation
]);
export type TransactionType = z.infer<typeof TransactionType>;

export const TransactionStatus = z.enum(['PENDING', 'CONFIRMED', 'FAILED']);
export type TransactionStatus = z.infer<typeof TransactionStatus>;

export type TransactionSource = 'ONCHAIN' | 'EXCHANGE' | 'MANUAL';

export interface Transaction {
  id: string;
  walletId?: string;       // null for exchange-only transactions
  signature?: string;      // null for exchange transactions
  type: TransactionType;
  status: TransactionStatus;
  timestamp: Date;
  slot?: number;           // null for exchange transactions
  blockTime?: number;      // null for exchange transactions
  fee?: bigint;            // null for exchange transactions
  feePayer?: string;       // null for exchange transactions

  // Source tracking
  source: TransactionSource;
  exchangeConnectionId?: string;
  exchangeName?: string;
  externalId?: string;
  linkedTransactionId?: string;

  // Token transfers
  transfers: TokenTransfer[];

  // Values
  totalValueUsd?: number;

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
  isFee?: boolean;
  priceAtExecution?: number;
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
