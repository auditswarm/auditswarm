import { Logger } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';
import {
  ExchangeApiConnector,
  SyncOptions,
  SyncResult,
  SyncPhaseResult,
  ConnectionTestResult,
} from './base-connector';
import { ExchangeRecord } from '../../exchange-imports/adapters/base-adapter';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const TWO_YEARS_MS = 2 * ONE_YEAR_MS; // Bybit max history limit

export class BybitConnector implements ExchangeApiConnector {
  readonly exchangeName = 'bybit';
  private readonly logger = new Logger(BybitConnector.name);
  private client: RestClientV5;

  constructor(apiKey: string, apiSecret: string) {
    this.client = new RestClientV5({
      key: apiKey,
      secret: apiSecret,
      recv_window: 10000,
    });
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const res = await this.client.getQueryApiKey();
      if (res.retCode !== 0) {
        return { valid: false, permissions: [], error: res.retMsg };
      }

      const info = res.result;
      const permissions: string[] = [];

      // Bybit permissions are in a different format — parse from the key info
      // The API returns readOnly, permissions object, etc.
      const perms = (info as any).permissions ?? {};
      if (perms.Spot?.includes('SpotTrade') || perms.ContractTrade?.length > 0) permissions.push('TRADE');
      if (perms.Wallet?.includes('AccountTransfer') || perms.Wallet?.includes('SubMemberTransferList')) permissions.push('TRANSFER');
      if ((info as any).readOnly === 0) permissions.push('WRITE');
      // All read-only keys can view deposits/withdrawals
      permissions.push('READ');

      return {
        valid: true,
        permissions,
        accountId: String((info as any).userID ?? (info as any).uid ?? ''),
      };
    } catch (error: any) {
      return {
        valid: false,
        permissions: [],
        error: error.message ?? 'Connection failed',
      };
    }
  }

  // ===== Legacy interface methods (delegate to phase methods) =====

  async fetchTrades(options: SyncOptions): Promise<SyncResult> {
    const result = await this.fetchPhase1(options);
    return { records: result.records.filter(r => r.type === 'TRADE'), cursor: result.cursor };
  }

  async fetchDeposits(options: SyncOptions): Promise<SyncResult> {
    const result = await this.fetchPhase1(options);
    return { records: result.records.filter(r => r.type === 'DEPOSIT') };
  }

  async fetchWithdrawals(options: SyncOptions): Promise<SyncResult> {
    const result = await this.fetchPhase1(options);
    return { records: result.records.filter(r => r.type === 'WITHDRAWAL') };
  }

  async fetchFiatTransactions(options: SyncOptions): Promise<SyncResult> {
    const result = await this.fetchPhase2(options);
    return { records: result.records.filter(r => r.type === 'C2C_TRADE') };
  }

  // ===== Phase-based comprehensive sync =====

  async fetchPhase(phase: number, options: SyncOptions): Promise<SyncPhaseResult> {
    switch (phase) {
      case 1: return this.fetchPhase1(options);
      case 2: return this.fetchPhase2(options);
      case 3: return this.fetchPhase3(options);
      case 4: return this.fetchPhase4(options);
      default: throw new Error(`Unknown phase: ${phase}`);
    }
  }

  // ===== PHASE 1: Core (deposits + withdrawals + spot trades) =====

  async fetchPhase1(options: SyncOptions): Promise<SyncPhaseResult> {
    const records: ExchangeRecord[] = [];
    const cursor = { ...(options.cursor ?? {}) };
    const errors: SyncPhaseResult['errors'] = [];

    // 1a. Deposit history (BEFORE trades — assets discovered here improve coverage)
    await this.safeRun('deposits', errors, async () => {
      const depositRecords = await this.fetchDepositHistory(options, cursor);
      records.push(...depositRecords);
    });

    // 1b. Withdrawal history
    await this.safeRun('withdrawals', errors, async () => {
      const withdrawalRecords = await this.fetchWithdrawalHistory(options, cursor);
      records.push(...withdrawalRecords);
    });

    // 1c. Spot trades (uses discovered assets from deposits/withdrawals)
    const discoveredAssets = new Set<string>();
    for (const r of records) {
      if (r.asset) discoveredAssets.add(r.asset.toUpperCase());
      if (r.quoteAsset) discoveredAssets.add(r.quoteAsset.toUpperCase());
    }
    await this.safeRun('trades', errors, async () => {
      const tradeRecords = await this.fetchSpotTrades(options, cursor, discoveredAssets);
      records.push(...tradeRecords);
    });

    return { phase: 1, records, cursor, errors };
  }

  // ===== PHASE 2: Conversions + P2P =====

  async fetchPhase2(options: SyncOptions): Promise<SyncPhaseResult> {
    const records: ExchangeRecord[] = [];
    const cursor = { ...(options.cursor ?? {}) };
    const errors: SyncPhaseResult['errors'] = [];

    // 2a. Convert history
    await this.safeRun('convert', errors, async () => {
      const convertRecords = await this.fetchConvertHistory(options, cursor);
      records.push(...convertRecords);
    });

    // 2b. P2P (C2C) trade history
    await this.safeRun('p2p', errors, async () => {
      const p2pRecords = await this.fetchP2PHistory(options, cursor);
      records.push(...p2pRecords);
    });

    return { phase: 2, records, cursor, errors };
  }

  // ===== PHASE 3: Passive Income (earn + yields + dividends) =====

  async fetchPhase3(options: SyncOptions): Promise<SyncPhaseResult> {
    const records: ExchangeRecord[] = [];
    const cursor = { ...(options.cursor ?? {}) };
    const errors: SyncPhaseResult['errors'] = [];

    // 3a. Earn order history (staking, flexible savings, on-chain earn)
    await this.safeRun('earnOrders', errors, async () => {
      const earnRecords = await this.fetchEarnOrders(options, cursor);
      records.push(...earnRecords);
    });

    // 3b. Earn yield history (rewards/interest from earn products)
    await this.safeRun('earnYield', errors, async () => {
      const yieldRecords = await this.fetchEarnYield(options, cursor);
      records.push(...yieldRecords);
    });

    // 3c. Transaction log — dividends, airdrops, bonuses
    await this.safeRun('transactionLog', errors, async () => {
      const logRecords = await this.fetchTransactionLogDividends(options, cursor);
      records.push(...logRecords);
    });

    return { phase: 3, records, cursor, errors };
  }

  // ===== PHASE 4: Advanced (margin/borrow + derivatives) =====

  async fetchPhase4(options: SyncOptions): Promise<SyncPhaseResult> {
    const records: ExchangeRecord[] = [];
    const cursor = { ...(options.cursor ?? {}) };
    const errors: SyncPhaseResult['errors'] = [];

    // 4a. Borrow history (Unified account interest records)
    await this.safeRun('borrowHistory', errors, async () => {
      const borrowRecords = await this.fetchBorrowHistory(options, cursor);
      records.push(...borrowRecords);
    });

    // 4b. Derivatives trades (linear perpetual/futures)
    await this.safeRun('derivativesTrades', errors, async () => {
      const derivRecords = await this.fetchDerivativesTrades(options, cursor);
      records.push(...derivRecords);
    });

    return { phase: 4, records, cursor, errors };
  }

  // ======== PRIVATE ENDPOINT IMPLEMENTATIONS ========

  // ---- Phase 1: Deposit history ----
  private async fetchDepositHistory(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];
    const now = Date.now();
    // Bybit deposit API defaults to last 30 days — must use time windows for full history
    const earliest = options.since?.getTime() ?? (now - TWO_YEARS_MS);
    const seen = new Set<string>();

    let windowEnd = now;
    while (windowEnd > earliest) {
      const windowStart = Math.max(windowEnd - THIRTY_DAYS_MS, earliest);
      let pageCursor: string | undefined;

      do {
        await this.delay(200);
        const res = await this.client.getDepositRecords({
          startTime: windowStart,
          endTime: windowEnd,
          limit: 50,
          cursor: pageCursor,
        });

        if (res.retCode !== 0) {
          this.logger.warn(`Deposit query failed: ${res.retMsg}`);
          break;
        }

        const rows = res.result?.rows ?? [];
        if (rows.length === 0) break;

        for (const d of rows) {
          const amount = parseFloat(d.amount);
          if (amount <= 0) continue;

          const key = d.txID || `${d.successAt}-${d.coin}-${d.amount}`;
          if (seen.has(key)) continue;
          seen.add(key);

          records.push({
            externalId: d.txID || `bybit-deposit-${d.successAt}-${d.coin}`,
            type: 'DEPOSIT',
            timestamp: new Date(parseInt(String(d.successAt), 10)),
            asset: d.coin,
            amount,
            network: d.chain,
            txId: d.txID || undefined,
            rawData: d as any,
          });
        }

        pageCursor = res.result?.nextPageCursor || undefined;
      } while (pageCursor);

      windowEnd = windowStart;
    }

    this.logger.log(`Fetched ${records.length} deposits`);
    return records;
  }

  // ---- Phase 1: Withdrawal history ----
  private async fetchWithdrawalHistory(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];
    const now = Date.now();
    // Bybit withdrawal API defaults to last 30 days — must use time windows
    const earliest = options.since?.getTime() ?? (now - TWO_YEARS_MS);
    const seen = new Set<string>();

    let windowEnd = now;
    while (windowEnd > earliest) {
      const windowStart = Math.max(windowEnd - THIRTY_DAYS_MS, earliest);
      let pageCursor: string | undefined;

      do {
        await this.delay(200);
        const res = await this.client.getWithdrawalRecords({
          startTime: windowStart,
          endTime: windowEnd,
          limit: 50,
          cursor: pageCursor,
        });

        if (res.retCode !== 0) {
          this.logger.warn(`Withdrawal query failed: ${res.retMsg}`);
          break;
        }

        const rows = (res.result as any)?.rows ?? [];
        if (rows.length === 0) break;

        for (const w of rows) {
          const amount = parseFloat(w.amount);
          if (amount <= 0) continue;

          const key = w.withdrawId || w.txID || `${w.createTime}-${w.coin}-${w.amount}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const fee = parseFloat(w.withdrawFee ?? '0');
          records.push({
            externalId: w.withdrawId || w.txID || `bybit-withdraw-${w.createTime}-${w.coin}`,
            type: 'WITHDRAWAL',
            timestamp: new Date(parseInt(String(w.createTime), 10)),
            asset: w.coin,
            amount,
            feeAmount: fee > 0 ? fee : undefined,
            feeAsset: fee > 0 ? w.coin : undefined,
            network: w.chain,
            txId: w.txID || undefined,
            rawData: w as any,
          });
        }

        pageCursor = (res.result as any)?.nextPageCursor || undefined;
      } while (pageCursor);

      windowEnd = windowStart;
    }

    this.logger.log(`Fetched ${records.length} withdrawals`);
    return records;
  }

  // ---- Phase 1: Spot trades ----
  private async fetchSpotTrades(
    options: SyncOptions,
    cursor: Record<string, any>,
    discoveredAssets?: Set<string>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];
    const now = Date.now();
    // Bybit execution list: max 2-year history, 7-day windows
    const earliest = options.since?.getTime() ?? (now - TWO_YEARS_MS + SEVEN_DAYS_MS);

    let windowEnd = now;
    let hitTimeLimit = false;
    while (windowEnd > earliest && !hitTimeLimit) {
      const windowStart = Math.max(windowEnd - SEVEN_DAYS_MS, earliest);
      let pageCursor: string | undefined = cursor.spotTradesCursor;

      do {
        await this.delay(50);
        const res = await this.client.getExecutionList({
          category: 'spot',
          startTime: windowStart,
          endTime: windowEnd,
          limit: 100,
          cursor: pageCursor,
        });

        if (res.retCode !== 0) {
          const msg = res.retMsg ?? '';
          // Bybit rejects queries older than 2 years — stop iterating
          if (msg.includes('2 year') || msg.includes('earlier than')) {
            this.logger.debug(`Spot trades hit time limit at window ${new Date(windowStart).toISOString()}, stopping`);
            hitTimeLimit = true;
            break;
          }
          this.logger.warn(`Spot trades query failed: ${msg}`);
          break;
        }

        const list = res.result?.list ?? [];
        for (const t of list) {
          const { base, quote } = this.parseSymbol(t.symbol);
          const execQty = parseFloat(t.execQty);
          const execPrice = parseFloat(t.execPrice);
          const execValue = parseFloat(t.execValue ?? '0') || execQty * execPrice;
          const fee = parseFloat(t.execFee ?? '0');

          records.push({
            externalId: t.execId,
            type: 'TRADE',
            timestamp: new Date(parseInt(String(t.execTime), 10)),
            asset: base,
            amount: execQty,
            priceUsd: undefined, // Will be resolved by mapper if quote is USD-like
            quoteAsset: quote,
            quoteAmount: execValue,
            feeAmount: Math.abs(fee),
            feeAsset: t.feeCurrency || (t.side === 'Buy' ? base : quote),
            side: t.side === 'Buy' ? 'BUY' : 'SELL',
            tradePair: t.symbol,
            rawData: t as any,
          });
        }

        pageCursor = res.result?.nextPageCursor || undefined;
        cursor.spotTradesCursor = pageCursor;
      } while (pageCursor);

      windowEnd = windowStart;
      cursor.spotTradesCursor = undefined;
    }

    this.logger.log(`Fetched ${records.length} spot trades`);
    return records;
  }

  // ---- Phase 2: Convert history ----
  private async fetchConvertHistory(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    try {
      let index = cursor.convertIndex ?? 0;
      let hasMore = true;

      while (hasMore) {
        await this.delay(500);
        const res = await this.client.getConvertHistory({
          index,
          limit: 100,
        } as any);

        if (res.retCode !== 0) {
          this.logger.warn(`Convert history failed: ${res.retMsg}`);
          break;
        }

        const list = res.result?.list ?? [];
        if (list.length === 0) break;

        for (const c of list) {
          const fromAmount = parseFloat((c as any).fromAmount ?? (c as any).volume ?? '0');
          const toAmount = parseFloat((c as any).toAmount ?? (c as any).targetVolume ?? '0');
          if (fromAmount <= 0) continue;

          const fromCoin = (c as any).fromCoin ?? (c as any).coin ?? '';
          const toCoin = (c as any).toCoin ?? (c as any).targetCoin ?? '';

          records.push({
            externalId: (c as any).exchangeTxId ?? (c as any).exchangeId ?? `bybit-convert-${(c as any).createdAt ?? index}`,
            type: 'CONVERT',
            timestamp: new Date(parseInt(String((c as any).createdAt ?? (c as any).startTime), 10)),
            asset: fromCoin,
            amount: fromAmount,
            quoteAsset: toCoin,
            quoteAmount: toAmount,
            rawData: c as any,
          });
        }

        index += list.length;
        cursor.convertIndex = index;
        hasMore = list.length >= 100;
      }
    } catch (error: any) {
      this.logger.debug(`Convert history not available: ${error.message}`);
    }

    this.logger.log(`Fetched ${records.length} conversions`);
    return records;
  }

  // ---- Phase 2: P2P (C2C) history ----
  private async fetchP2PHistory(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    try {
      let page = cursor.p2pPage ?? 1;
      let hasMore = true;

      while (hasMore) {
        await this.delay(500);
        const res = await this.client.getP2POrders({
          page: String(page),
          size: '50',
        } as any);

        if (res.retCode !== undefined && res.retCode !== 0) {
          this.logger.warn(`P2P orders failed: ${res.retMsg}`);
          break;
        }

        const result = res.result as any;
        if (!result || (typeof result === 'object' && Object.keys(result).length === 0)) break;
        const items = result?.items ?? result?.list ?? [];
        if (!Array.isArray(items) || items.length === 0) break;

        for (const p of items) {
          // Only completed orders
          const status = String(p.orderStatus ?? p.status ?? '').toUpperCase();
          if (status !== 'COMPLETED' && status !== '50') continue;

          const amount = parseFloat(p.amount ?? p.quantity ?? '0');
          const totalPrice = parseFloat(p.totalPrice ?? p.price ?? '0');
          const unitPrice = parseFloat(p.unitPrice ?? '0');
          const asset = p.tokenId ?? p.crypto ?? p.asset ?? '';
          const fiat = p.currencyId ?? p.fiat ?? '';

          // Determine BUY or SELL based on the side field
          const side: 'BUY' | 'SELL' = String(p.side ?? p.orderType ?? '').toUpperCase().includes('BUY') ? 'BUY' : 'SELL';

          records.push({
            externalId: p.orderId ?? p.id ?? `bybit-p2p-${p.createTime}`,
            type: 'C2C_TRADE',
            timestamp: new Date(parseInt(String(p.createTime ?? p.createdAt), 10)),
            asset,
            amount,
            priceUsd: fiat === 'USD' ? unitPrice : undefined,
            totalValueUsd: fiat === 'USD' ? totalPrice : undefined,
            quoteAsset: fiat,
            quoteAmount: totalPrice,
            side,
            isP2P: true,
            rawData: p as any,
          });
        }

        page++;
        cursor.p2pPage = page;
        hasMore = items.length >= 50;
      }
    } catch (error: any) {
      this.logger.debug(`P2P orders not available: ${error.message}`);
    }

    this.logger.log(`Fetched ${records.length} P2P trades`);
    return records;
  }

  // ---- Phase 3: Earn order history ----
  private async fetchEarnOrders(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    for (const category of ['FlexibleSaving', 'StakingProduct', 'OnChain'] as const) {
      try {
        let pageCursor: string | undefined = cursor[`earn_${category}_cursor`];
        let hasMore = true;

        while (hasMore) {
          await this.delay(500);
          const res = await this.client.getEarnOrderHistory({
            category: category as any,
            limit: 100,
            cursor: pageCursor,
          } as any);

          if (res.retCode !== 0) {
            this.logger.warn(`Earn ${category} orders failed: ${res.retMsg}`);
            break;
          }

          const list = res.result?.list ?? [];
          if (list.length === 0) break;

          for (const e of list) {
            const coin = (e as any).coin ?? '';
            const amount = parseFloat((e as any).amount ?? (e as any).orderValue ?? '0');
            if (amount <= 0) continue;

            const earnType = String((e as any).earnType ?? (e as any).type ?? '').toUpperCase();
            let type: ExchangeRecord['type'] = 'STAKE';
            if (earnType.includes('REDEEM') || earnType.includes('UNSTAKE')) {
              type = 'UNSTAKE';
            }

            records.push({
              externalId: (e as any).orderId ?? `bybit-earn-${(e as any).orderTime ?? category}-${coin}`,
              type,
              timestamp: new Date(parseInt(String((e as any).orderTime ?? (e as any).createdTime), 10)),
              asset: coin,
              amount,
              rawData: e as any,
            });
          }

          pageCursor = res.result?.nextPageCursor || undefined;
          cursor[`earn_${category}_cursor`] = pageCursor;
          hasMore = !!pageCursor && list.length >= 100;
        }
      } catch (error: any) {
        this.logger.debug(`Earn ${category} orders not available: ${error.message}`);
      }
    }

    this.logger.log(`Fetched ${records.length} earn orders`);
    return records;
  }

  // ---- Phase 3: Earn yield/rewards history ----
  private async fetchEarnYield(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    try {
      let pageCursor: string | undefined = cursor.earnYieldCursor;
      let hasMore = true;

      while (hasMore) {
        await this.delay(500);
        const res = await this.client.getEarnYieldHistory({
          limit: 100,
          cursor: pageCursor,
        } as any);

        if (res.retCode !== 0) {
          this.logger.warn(`Earn yield history failed: ${res.retMsg}`);
          break;
        }

        const yields = (res.result as any)?.yield ?? (res.result as any)?.list ?? [];
        if (!Array.isArray(yields) || yields.length === 0) break;

        for (const y of yields) {
          const coin = y.coin ?? '';
          const amount = parseFloat(y.amount ?? y.yieldAmount ?? '0');
          if (amount <= 0) continue;

          records.push({
            externalId: y.orderId ?? `bybit-yield-${y.createdTime ?? y.timestamp}-${coin}`,
            type: 'INTEREST',
            timestamp: new Date(parseInt(String(y.createdTime ?? y.timestamp), 10)),
            asset: coin,
            amount,
            rawData: y as any,
          });
        }

        pageCursor = (res.result as any)?.nextPageCursor || undefined;
        cursor.earnYieldCursor = pageCursor;
        hasMore = !!pageCursor && yields.length >= 100;
      }
    } catch (error: any) {
      this.logger.debug(`Earn yield history not available: ${error.message}`);
    }

    this.logger.log(`Fetched ${records.length} earn yields`);
    return records;
  }

  // ---- Phase 3: Transaction log dividends/airdrops ----
  private async fetchTransactionLogDividends(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    // Transaction types that represent dividends/airdrops/bonuses
    const dividendTypes = ['AIRDROP', 'BONUS', 'CASHBACK', 'FEE_REFUND', 'INTEREST'];

    try {
      let pageCursor: string | undefined = cursor.txLogCursor;
      let hasMore = true;

      while (hasMore) {
        await this.delay(500);
        const res = await this.client.getTransactionLog({
          limit: 50,
          cursor: pageCursor,
        });

        if (res.retCode !== 0) {
          this.logger.warn(`Transaction log failed: ${res.retMsg}`);
          break;
        }

        const list = (res.result as any)?.list ?? [];
        if (list.length === 0) break;

        for (const log of list) {
          const txType = String(log.type ?? '').toUpperCase();

          // Filter to dividend-like transaction types
          if (!dividendTypes.some(dt => txType.includes(dt))) continue;

          const coin = log.currency ?? log.coin ?? '';
          const amount = Math.abs(parseFloat(log.change ?? log.amount ?? '0'));
          if (amount <= 0) continue;

          records.push({
            externalId: log.transactionTime ? `bybit-txlog-${log.transactionTime}-${coin}` : undefined,
            type: 'DIVIDEND',
            timestamp: new Date(parseInt(String(log.transactionTime ?? log.createdTime), 10)),
            asset: coin,
            amount,
            rawData: log as any,
          });
        }

        pageCursor = (res.result as any)?.nextPageCursor || undefined;
        cursor.txLogCursor = pageCursor;
        hasMore = !!pageCursor && list.length >= 50;
      }
    } catch (error: any) {
      this.logger.debug(`Transaction log not available: ${error.message}`);
    }

    this.logger.log(`Fetched ${records.length} dividend/bonus records`);
    return records;
  }

  // ---- Phase 4: Borrow history ----
  private async fetchBorrowHistory(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    try {
      let pageCursor: string | undefined = cursor.borrowCursor;
      let hasMore = true;

      while (hasMore) {
        await this.delay(500);
        const res = await this.client.getBorrowHistory({
          limit: 50,
          cursor: pageCursor,
        });

        if (res.retCode !== 0) {
          this.logger.warn(`Borrow history failed: ${res.retMsg}`);
          break;
        }

        const list = (res.result as any)?.list ?? [];
        if (list.length === 0) break;

        for (const b of list) {
          const coin = b.currency ?? '';
          const borrowCost = parseFloat(b.borrowCost ?? '0');

          if (borrowCost > 0) {
            records.push({
              externalId: `bybit-borrow-interest-${b.createdTime}-${coin}`,
              type: 'MARGIN_INTEREST',
              timestamp: new Date(parseInt(String(b.createdTime), 10)),
              asset: coin,
              amount: borrowCost,
              rawData: b as any,
            });
          }
        }

        pageCursor = (res.result as any)?.nextPageCursor || undefined;
        cursor.borrowCursor = pageCursor;
        hasMore = !!pageCursor && list.length >= 50;
      }
    } catch (error: any) {
      this.logger.debug(`Borrow history not available: ${error.message}`);
    }

    this.logger.log(`Fetched ${records.length} borrow records`);
    return records;
  }

  // ---- Phase 4: Derivatives trades ----
  private async fetchDerivativesTrades(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];
    const now = Date.now();
    // Bybit: max 2-year history for execution list
    const earliest = options.since?.getTime() ?? (now - TWO_YEARS_MS + SEVEN_DAYS_MS);

    let windowEnd = now;
    let hitTimeLimit = false;
    while (windowEnd > earliest && !hitTimeLimit) {
      const windowStart = Math.max(windowEnd - SEVEN_DAYS_MS, earliest);
      let pageCursor: string | undefined = cursor.derivTradesCursor;

      do {
        await this.delay(50);
        const res = await this.client.getExecutionList({
          category: 'linear',
          startTime: windowStart,
          endTime: windowEnd,
          limit: 100,
          cursor: pageCursor,
        });

        if (res.retCode !== 0) {
          const msg = res.retMsg ?? '';
          if (msg.includes('2 year') || msg.includes('earlier than')) {
            hitTimeLimit = true;
            break;
          }
          this.logger.warn(`Derivatives trades query failed: ${msg}`);
          break;
        }

        const list = res.result?.list ?? [];
        for (const t of list) {
          const { base, quote } = this.parseSymbol(t.symbol);
          const execQty = parseFloat(t.execQty);
          const execPrice = parseFloat(t.execPrice);
          const execValue = parseFloat(t.execValue ?? '0') || execQty * execPrice;
          const fee = parseFloat(t.execFee ?? '0');

          records.push({
            externalId: t.execId,
            type: 'TRADE',
            timestamp: new Date(parseInt(String(t.execTime), 10)),
            asset: base,
            amount: execQty,
            quoteAsset: quote,
            quoteAmount: execValue,
            feeAmount: Math.abs(fee),
            feeAsset: t.feeCurrency || quote,
            side: t.side === 'Buy' ? 'BUY' : 'SELL',
            tradePair: t.symbol,
            rawData: t as any,
          });
        }

        pageCursor = res.result?.nextPageCursor || undefined;
        cursor.derivTradesCursor = pageCursor;
      } while (pageCursor);

      windowEnd = windowStart;
      cursor.derivTradesCursor = undefined;
    }

    this.logger.log(`Fetched ${records.length} derivatives trades`);
    return records;
  }

  // ===== Real-time balances =====

  async fetchRealTimeBalances(): Promise<{ asset: string; free: number; locked: number; source: string }[]> {
    const balances: { asset: string; free: number; locked: number; source: string }[] = [];

    // UNIFIED account (covers spot + derivatives + margin in unified mode)
    try {
      const res = await this.client.getWalletBalance({ accountType: 'UNIFIED' });
      if (res.retCode === 0 && res.result?.list?.length > 0) {
        for (const account of res.result.list) {
          const coins = (account as any).coin ?? [];
          for (const c of coins) {
            const free = parseFloat(c.availableToWithdraw ?? c.walletBalance ?? '0');
            const locked = parseFloat(c.locked ?? '0');
            const total = parseFloat(c.walletBalance ?? '0');
            if (total > 0 || free > 0 || locked > 0) {
              balances.push({
                asset: c.coin,
                free,
                locked: total - free,
                source: 'unified',
              });
            }
          }
        }
      }
    } catch (error: any) {
      this.logger.debug(`UNIFIED balance not available: ${error.message}`);
    }

    // FUND account (funding wallet — for P2P, payment, etc.)
    try {
      const res = await this.client.getAllCoinsBalance({ accountType: 'FUND' });
      if (res.retCode === 0) {
        const coins = (res.result as any)?.balance ?? [];
        for (const c of coins) {
          const free = parseFloat(c.walletBalance ?? c.transferBalance ?? '0');
          if (free > 0) {
            balances.push({
              asset: c.coin,
              free,
              locked: 0,
              source: 'fund',
            });
          }
        }
      }
    } catch (error: any) {
      this.logger.debug(`FUND balance not available: ${error.message}`);
    }

    // Earn positions (staked assets)
    try {
      const res = await this.client.getEarnPosition({} as any);
      if (res.retCode === 0) {
        const positions = res.result?.list ?? [];
        for (const p of positions) {
          const amount = parseFloat((p as any).amount ?? '0');
          if (amount > 0) {
            balances.push({
              asset: (p as any).coin,
              free: 0,
              locked: amount,
              source: 'earn',
            });
          }
        }
      }
    } catch (error: any) {
      this.logger.debug(`Earn positions not available: ${error.message}`);
    }

    return balances;
  }

  // ===== Deposit address discovery =====

  async fetchDepositAddresses(): Promise<{ coin: string; network: string; address: string; tag?: string }[]> {
    const addresses: { coin: string; network: string; address: string; tag?: string }[] = [];

    try {
      // Get coins that have balance or that we've deposited
      const balRes = await this.client.getAllCoinsBalance({ accountType: 'UNIFIED' });
      const coins: string[] = [];
      if (balRes.retCode === 0) {
        const balanceList = (balRes.result as any)?.balance ?? [];
        for (const b of balanceList) {
          if (parseFloat(b.walletBalance ?? '0') > 0) {
            coins.push(b.coin);
          }
        }
      }

      // For common coins, try to get deposit addresses
      const commonCoins = [...new Set([...coins, 'BTC', 'ETH', 'USDT', 'USDC', 'SOL'])];
      for (const coin of commonCoins) {
        try {
          await this.delay(200);
          // Use the master deposit address endpoint
          const res = await (this.client as any).getMasterDepositAddress?.({ coin });
          if (res?.retCode === 0 && res.result?.chains) {
            for (const chain of res.result.chains) {
              if (chain.addressDeposit) {
                addresses.push({
                  coin,
                  network: chain.chain ?? chain.chainType ?? '',
                  address: chain.addressDeposit,
                  tag: chain.tagDeposit || undefined,
                });
              }
            }
          }
        } catch {
          // Some coins may not support deposit address query
        }
      }
    } catch (error: any) {
      this.logger.warn(`Failed to fetch deposit addresses: ${error.message}`);
    }

    this.logger.log(`Fetched ${addresses.length} deposit addresses`);
    return addresses;
  }

  // ======== UTILITIES ========

  private parseSymbol(symbol: string): { base: string; quote: string } {
    const knownQuotes = ['USDT', 'USDC', 'USDE', 'BTC', 'ETH', 'DAI', 'EUR', 'BRL', 'USD'];
    for (const q of knownQuotes) {
      if (symbol.endsWith(q) && symbol.length > q.length) {
        return { base: symbol.slice(0, -q.length), quote: q };
      }
    }
    // Fallback: assume last 4 chars are quote
    return { base: symbol.slice(0, -4), quote: symbol.slice(-4) };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async safeRun(
    endpoint: string,
    errors: SyncPhaseResult['errors'],
    fn: () => Promise<void>,
  ): Promise<void> {
    try {
      await fn();
    } catch (error: any) {
      this.logger.error(`${endpoint} failed: ${error.message}`);
      errors.push({ endpoint, error: error.message });
    }
  }
}
