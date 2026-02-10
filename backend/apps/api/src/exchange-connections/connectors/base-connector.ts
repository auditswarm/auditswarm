import { ExchangeRecord } from '../../exchange-imports/adapters/base-adapter';

export interface SyncOptions {
  since?: Date;
  until?: Date;
  cursor?: any; // exchange-specific pagination state
  fullSync?: boolean;
}

export interface SyncResult {
  records: ExchangeRecord[];
  cursor?: any; // updated pagination state for next sync
  hasMore?: boolean;
}

export interface SyncPhaseResult {
  phase: number;
  records: ExchangeRecord[];
  cursor: Record<string, any>;
  errors: { endpoint: string; error: string }[];
}

export interface ConnectionTestResult {
  valid: boolean;
  permissions: string[];
  accountId?: string;
  error?: string;
}

export interface ExchangeApiConnector {
  readonly exchangeName: string;

  /** Validate credentials and return account permissions */
  testConnection(): Promise<ConnectionTestResult>;

  /** Fetch spot/margin trades */
  fetchTrades(options: SyncOptions): Promise<SyncResult>;

  /** Fetch crypto deposits into the exchange */
  fetchDeposits(options: SyncOptions): Promise<SyncResult>;

  /** Fetch crypto withdrawals from the exchange */
  fetchWithdrawals(options: SyncOptions): Promise<SyncResult>;

  /** Fetch fiat buy/sell transactions (on/off ramps) */
  fetchFiatTransactions(options: SyncOptions): Promise<SyncResult>;

  /** Phase-based comprehensive sync (optional, for advanced connectors) */
  fetchPhase?(phase: number, options: SyncOptions): Promise<SyncPhaseResult>;

  /** Fetch real-time balances across all wallet types (spot, earn, margin, futures) */
  fetchRealTimeBalances?(): Promise<{ asset: string; free: number; locked: number; source: string }[]>;

  /** Fetch user's deposit addresses for all supported coins/networks */
  fetchDepositAddresses?(): Promise<{ coin: string; network: string; address: string; tag?: string }[]>;
}

/** Factory function type for creating connectors */
export type ConnectorFactory = (apiKey: string, apiSecret: string) => ExchangeApiConnector;
