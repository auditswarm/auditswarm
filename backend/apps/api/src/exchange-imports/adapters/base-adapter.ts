export type ExchangeRecordType =
  | 'TRADE'
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'FEE'
  | 'FIAT_BUY'
  | 'FIAT_SELL'
  | 'CONVERT'
  | 'DUST_CONVERT'
  | 'C2C_TRADE'
  | 'STAKE'
  | 'UNSTAKE'
  | 'INTEREST'
  | 'DIVIDEND'
  | 'MARGIN_BORROW'
  | 'MARGIN_REPAY'
  | 'MARGIN_INTEREST'
  | 'MARGIN_LIQUIDATION'
  | 'MINING';

export interface ExchangeRecord {
  externalId?: string;
  type: ExchangeRecordType;
  timestamp: Date;
  asset: string;
  amount: number;
  priceUsd?: number;
  totalValueUsd?: number;
  feeAmount?: number;
  feeAsset?: string;
  side?: 'BUY' | 'SELL';
  tradePair?: string;
  // Extended fields for comprehensive sync
  quoteAsset?: string;     // quote asset in a trade (USDT in SOL/USDT)
  quoteAmount?: number;    // amount of quote asset
  network?: string;        // blockchain network for deposits/withdrawals
  txId?: string;           // blockchain transaction hash
  isP2P?: boolean;         // P2P/C2C trade flag
  rawData?: Record<string, unknown>;
}

export interface ExchangeAdapter {
  readonly exchangeName: string;
  parse(csvContent: string): ExchangeRecord[];
}
