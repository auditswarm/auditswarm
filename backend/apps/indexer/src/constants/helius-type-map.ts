// Maps Helius Enhanced transaction types to our TransactionType enum
// Reference: https://docs.helius.dev/solana-apis/enhanced-transactions-api/parsed-transaction-history

export type HeliusTransactionType =
  | 'TRANSFER'
  | 'SWAP'
  | 'BURN'
  | 'BURN_NFT'
  | 'COMPRESSED_NFT_BURN'
  | 'NFT_MINT'
  | 'NFT_SALE'
  | 'NFT_LISTING'
  | 'NFT_CANCEL_LISTING'
  | 'NFT_BID'
  | 'NFT_BID_CANCELLED'
  | 'COMPRESSED_NFT_MINT'
  | 'COMPRESSED_NFT_TRANSFER'
  | 'TOKEN_MINT'
  | 'STAKE_SOL'
  | 'UNSTAKE_SOL'
  | 'INIT_STAKE'
  | 'MERGE_STAKE'
  | 'SPLIT_STAKE'
  | 'WITHDRAW_STAKE'
  | 'ADD_LIQUIDITY'
  | 'REMOVE_LIQUIDITY'
  | 'BORROW_FOX'
  | 'LOAN'
  | 'REPAY_LOAN'
  | 'CLOSE_ACCOUNT'
  | 'INITIALIZE_ACCOUNT'
  | 'UPGRADE_PROGRAM_INSTRUCTION'
  | 'UNKNOWN';

export interface TypeMapping {
  txType: string | null; // null = skip in MVP
  directionBased?: boolean; // resolve IN/OUT from transfer direction
}

export const HELIUS_TYPE_MAP: Map<string, TypeMapping> = new Map([
  // Direct mappings
  ['SWAP', { txType: 'SWAP' }],
  ['BURN', { txType: 'BURN' }],
  ['TOKEN_MINT', { txType: 'MINT' }],

  // Staking
  ['STAKE_SOL', { txType: 'STAKE' }],
  ['UNSTAKE_SOL', { txType: 'UNSTAKE' }],
  ['INIT_STAKE', { txType: 'STAKE' }],
  ['MERGE_STAKE', { txType: 'STAKE' }],
  ['SPLIT_STAKE', { txType: 'STAKE' }],
  ['WITHDRAW_STAKE', { txType: 'UNSTAKE' }],

  // Transfers - need direction resolution
  ['TRANSFER', { txType: 'TRANSFER', directionBased: true }],

  // DeFi / Liquidity
  ['ADD_LIQUIDITY', { txType: 'LP_DEPOSIT' }],
  ['REMOVE_LIQUIDITY', { txType: 'LP_WITHDRAW' }],

  // Lending
  ['LOAN', { txType: 'LOAN_BORROW' }],
  ['REPAY_LOAN', { txType: 'LOAN_REPAY' }],

  // NFT types - skip in MVP (SOL + SPL fungibles only)
  ['BURN_NFT', { txType: null }],
  ['COMPRESSED_NFT_BURN', { txType: null }],
  ['NFT_MINT', { txType: null }],
  ['NFT_SALE', { txType: null }],
  ['NFT_LISTING', { txType: null }],
  ['NFT_CANCEL_LISTING', { txType: null }],
  ['NFT_BID', { txType: null }],
  ['NFT_BID_CANCELLED', { txType: null }],
  ['COMPRESSED_NFT_MINT', { txType: null }],
  ['COMPRESSED_NFT_TRANSFER', { txType: null }],

  // Close account — resolve via transfer direction (Meteora LP withdrawals come as this)
  ['CLOSE_ACCOUNT', { txType: 'UNKNOWN', directionBased: true }],

  // Unknown — resolve via transfer direction when transfers are present
  ['UNKNOWN', { txType: 'UNKNOWN', directionBased: true }],

  // Program upgrades / infrastructure
  ['UPGRADE_PROGRAM_INSTRUCTION', { txType: 'PROGRAM_INTERACTION' }],

  // Account initialization — resolve direction for rent deposits
  ['INITIALIZE_ACCOUNT', { txType: 'PROGRAM_INTERACTION' }],
]);

export function mapHeliusType(heliusType: string): TypeMapping {
  return HELIUS_TYPE_MAP.get(heliusType) ?? { txType: 'UNKNOWN' };
}
