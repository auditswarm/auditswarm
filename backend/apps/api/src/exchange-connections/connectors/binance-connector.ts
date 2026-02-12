import { Logger } from '@nestjs/common';
import { MainClient } from 'binance';
import {
  ExchangeApiConnector,
  SyncOptions,
  SyncResult,
  SyncPhaseResult,
  ConnectionTestResult,
} from './base-connector';
import { ExchangeRecord } from '../../exchange-imports/adapters/base-adapter';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const THREE_YEARS_MS = 3 * ONE_YEAR_MS;

export class BinanceConnector implements ExchangeApiConnector {
  readonly exchangeName = 'binance';
  private readonly logger = new Logger(BinanceConnector.name);
  private client: MainClient;

  constructor(apiKey: string, apiSecret: string) {
    this.client = new MainClient({ api_key: apiKey, api_secret: apiSecret });
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const account = await this.client.getAccountInformation();
      const permissions: string[] = [];
      if (account.canTrade) permissions.push('TRADE');
      if (account.canWithdraw) permissions.push('WITHDRAW');
      if (account.canDeposit) permissions.push('DEPOSIT');

      return {
        valid: true,
        permissions,
        accountId: String(account.uid),
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
    const result = await this.fetchPhase1(options);
    return { records: result.records.filter(r => r.type === 'FIAT_BUY' || r.type === 'FIAT_SELL') };
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

  // ===== PHASE 1: Core (trades + deposits + withdrawals + fiat) =====

  async fetchPhase1(options: SyncOptions): Promise<SyncPhaseResult> {
    const records: ExchangeRecord[] = [];
    const cursor = { ...(options.cursor ?? {}) };
    const errors: SyncPhaseResult['errors'] = [];

    // 1b. Deposit history (BEFORE trades — assets discovered here improve trade pair coverage)
    await this.safeRun('deposits', errors, async () => {
      const depositRecords = await this.fetchDepositHistory(options, cursor);
      records.push(...depositRecords);
    });

    // 1c. Withdrawal history
    await this.safeRun('withdrawals', errors, async () => {
      const withdrawalRecords = await this.fetchWithdrawalHistory(options, cursor);
      records.push(...withdrawalRecords);
    });

    // 1d. Fiat payments (buy/sell crypto with fiat)
    await this.safeRun('fiatPayments', errors, async () => {
      const fiatRecords = await this.fetchFiatPayments(options, cursor);
      records.push(...fiatRecords);
    });

    // 1e. Fiat orders (bank deposit/withdrawal)
    await this.safeRun('fiatOrders', errors, async () => {
      const fiatOrderRecords = await this.fetchFiatOrders(options, cursor);
      records.push(...fiatOrderRecords);
    });

    // 1a. Spot trades (AFTER deposits/withdrawals — uses discovered assets for pair generation)
    const discoveredAssets = new Set<string>();
    for (const r of records) {
      if (r.asset) discoveredAssets.add(r.asset.toUpperCase());
      if (r.quoteAsset) discoveredAssets.add(r.quoteAsset.toUpperCase());
      if (r.feeAsset) discoveredAssets.add(r.feeAsset.toUpperCase());
    }
    await this.safeRun('trades', errors, async () => {
      const tradeRecords = await this.fetchSpotTrades(options, cursor, discoveredAssets);
      records.push(...tradeRecords);
    });

    return { phase: 1, records, cursor, errors };
  }

  // ===== PHASE 2: Conversions (convert + dust + C2C) =====

  async fetchPhase2(options: SyncOptions): Promise<SyncPhaseResult> {
    const records: ExchangeRecord[] = [];
    const cursor = { ...(options.cursor ?? {}) };
    const errors: SyncPhaseResult['errors'] = [];

    // 2a. Convert trade history
    await this.safeRun('convert', errors, async () => {
      const convertRecords = await this.fetchConvertHistory(options, cursor);
      records.push(...convertRecords);
    });

    // 2b. Dust log (small balance conversion to BNB)
    await this.safeRun('dust', errors, async () => {
      const dustRecords = await this.fetchDustLog(options, cursor);
      records.push(...dustRecords);
    });

    // 2c. C2C (P2P) trade history
    await this.safeRun('c2c', errors, async () => {
      const c2cRecords = await this.fetchC2CHistory(options, cursor);
      records.push(...c2cRecords);
    });

    return { phase: 2, records, cursor, errors };
  }

  // ===== PHASE 3: Passive Income (staking + earn + dividends) =====

  async fetchPhase3(options: SyncOptions): Promise<SyncPhaseResult> {
    const records: ExchangeRecord[] = [];
    const cursor = { ...(options.cursor ?? {}) };
    const errors: SyncPhaseResult['errors'] = [];

    // 3a. ETH Staking
    await this.safeRun('ethStaking', errors, async () => {
      const ethRecords = await this.fetchEthStaking(options, cursor);
      records.push(...ethRecords);
    });

    // 3b. SOL Staking
    await this.safeRun('solStaking', errors, async () => {
      const solRecords = await this.fetchSolStaking(options, cursor);
      records.push(...solRecords);
    });

    // 3c. Flexible Savings (Simple Earn)
    await this.safeRun('flexibleEarn', errors, async () => {
      const flexRecords = await this.fetchFlexibleEarn(options, cursor);
      records.push(...flexRecords);
    });

    // 3d. Locked Savings (Simple Earn)
    await this.safeRun('lockedEarn', errors, async () => {
      const lockedRecords = await this.fetchLockedEarn(options, cursor);
      records.push(...lockedRecords);
    });

    // 3e. Asset Dividends (airdrops, staking rewards distributed by Binance)
    await this.safeRun('dividends', errors, async () => {
      const divRecords = await this.fetchAssetDividends(options, cursor);
      records.push(...divRecords);
    });

    return { phase: 3, records, cursor, errors };
  }

  // ===== PHASE 4: Advanced (margin + mining + loans) =====

  async fetchPhase4(options: SyncOptions): Promise<SyncPhaseResult> {
    const records: ExchangeRecord[] = [];
    const cursor = { ...(options.cursor ?? {}) };
    const errors: SyncPhaseResult['errors'] = [];

    // 4a. Margin capital flow
    await this.safeRun('marginFlow', errors, async () => {
      const marginRecords = await this.fetchMarginCapitalFlow(options, cursor);
      records.push(...marginRecords);
    });

    // 4b. Margin interest history
    await this.safeRun('marginInterest', errors, async () => {
      const interestRecords = await this.fetchMarginInterest(options, cursor);
      records.push(...interestRecords);
    });

    // 4c. Margin borrow/repay records
    await this.safeRun('marginBorrowRepay', errors, async () => {
      const brRecords = await this.fetchMarginBorrowRepay(options, cursor);
      records.push(...brRecords);
    });

    // 4d. Mining earnings
    await this.safeRun('mining', errors, async () => {
      const miningRecords = await this.fetchMiningEarnings(options, cursor);
      records.push(...miningRecords);
    });

    // 4e. Crypto loan history
    await this.safeRun('loans', errors, async () => {
      const loanRecords = await this.fetchCryptoLoans(options, cursor);
      records.push(...loanRecords);
    });

    return { phase: 4, records, cursor, errors };
  }

  // ======== PRIVATE ENDPOINT IMPLEMENTATIONS ========

  // ---- Phase 1: Spot trades ----
  private async fetchSpotTrades(
    options: SyncOptions,
    cursor: Record<string, any>,
    discoveredAssets?: Set<string>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    // Discover ALL assets ever held (including zero-balance)
    const assets = new Set<string>();
    try {
      const userAssets = await (this.client as any).getUserAsset?.({});
      if (Array.isArray(userAssets)) {
        for (const a of userAssets) {
          assets.add(a.asset);
        }
        this.logger.log(`getUserAsset discovered ${assets.size} assets`);
      }
    } catch {
      this.logger.debug('getUserAsset not available, falling back to account balances');
    }

    // Fallback: current non-zero balances
    if (assets.size === 0) {
      const account = await this.client.getAccountInformation();
      for (const b of account.balances) {
        if (parseFloat((b as any).free) > 0 || parseFloat((b as any).locked) > 0) {
          assets.add((b as any).asset);
        }
      }
    }

    // Add assets discovered from deposits/withdrawals/converts in this sync
    if (discoveredAssets?.size) {
      const fiatCurrencies = new Set(['USD', 'BRL', 'EUR', 'GBP', 'AUD', 'CAD', 'JPY', 'TRY', 'RUB', 'NGN']);
      for (const a of discoveredAssets) {
        if (!fiatCurrencies.has(a)) assets.add(a);
      }
      this.logger.log(`Added ${discoveredAssets.size} assets from deposit/withdrawal history`);
    }

    const quoteCurrencies = ['USDT', 'USDC', 'BTC', 'BUSD', 'FDUSD', 'BRL', 'EUR', 'BNB', 'ETH', 'TRY'];
    const symbols = new Set<string>();
    for (const asset of assets) {
      for (const quote of quoteCurrencies) {
        if (asset !== quote) symbols.add(`${asset}${quote}`);
      }
    }
    // Common pairs that should always be checked
    const commonPairs = [
      'SOLUSDT', 'SOLUSDC', 'SOLBTC', 'SOLBNB', 'SOLBRL', 'SOLFDUSD',
      'BTCUSDT', 'BTCUSDC', 'BTCBUSD', 'BTCBRL', 'BTCFDUSD', 'BTCEUR',
      'ETHUSDT', 'ETHUSDC', 'ETHBTC', 'ETHBUSD', 'ETHBRL', 'ETHFDUSD',
      'BNBUSDT', 'BNBUSDC', 'BNBBTC', 'BNBBUSD', 'BNBFDUSD', 'BNBBRL',
      'ADAUSDT', 'DOTUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'MATICUSDT',
      'LINKUSDT', 'UNIUSDT', 'LTCUSDT', 'ATOMUSDT', 'NEARUSDT', 'APTUSDT',
      'SUIUSDT', 'ARBUSDT', 'OPUSDT', 'JUPUSDT', 'WIFUSDT', 'BONKUSDT',
      'FTMUSDT', 'SHIBUSDT', 'TRXUSDT', 'JUPUSDT', 'JTOUSDT', 'PYTHUSDT',
      'RAYUSDT', 'ORCAUSDT', 'MNDUSDT',
    ];
    for (const s of commonPairs) {
      symbols.add(s);
    }

    // Filter to valid symbols using exchangeInfo (cached in cursor)
    let validSymbolSet: Set<string> = new Set(cursor.validSymbols ?? []);
    if (validSymbolSet.size === 0) {
      try {
        const info = await this.client.getExchangeInfo();
        for (const s of info.symbols) {
          validSymbolSet.add(s.symbol);
        }
        cursor.validSymbols = [...validSymbolSet];
        this.logger.log(`Cached ${validSymbolSet.size} valid trading symbols`);
      } catch {
        this.logger.debug('Could not fetch exchangeInfo, will try all symbols');
      }
    }

    // Only try symbols that exist on exchange
    const filteredSymbols = validSymbolSet.size > 0
      ? [...symbols].filter(s => validSymbolSet.has(s))
      : [...symbols];

    const processedSymbols: string[] = cursor.processedSymbols ?? [];
    const symbolList = filteredSymbols.filter(s => !processedSymbols.includes(s));

    this.logger.log(`Fetching trades for ${symbolList.length} symbols (${processedSymbols.length} already processed)`);

    for (const symbol of symbolList) {
      try {
        const fromId = cursor[`fromId_${symbol}`];
        const trades = await this.client.getAccountTradeList({
          symbol,
          limit: 1000,
          ...(fromId ? { fromId } : {}),
          // Pass startTime to API to avoid fetching already-synced data
          ...(!fromId && options.since ? { startTime: options.since.getTime() } : {}),
          ...(options.until ? { endTime: options.until.getTime() } : {}),
        });

        if (Array.isArray(trades) && trades.length > 0) {
          for (const trade of trades) {
            const timestamp = new Date(trade.time);
            if (options.since && timestamp < options.since) continue;
            if (options.until && timestamp > options.until) continue;

            const { base, quote } = this.parseSymbol(symbol);

            records.push({
              externalId: `trade-${trade.id}`,
              type: 'TRADE',
              timestamp,
              asset: base,
              amount: parseFloat(String(trade.qty)),
              priceUsd: quote.includes('USD') ? parseFloat(String(trade.price)) : undefined,
              totalValueUsd: quote.includes('USD') ? parseFloat(String(trade.quoteQty)) : undefined,
              feeAmount: parseFloat(String(trade.commission)),
              feeAsset: trade.commissionAsset,
              side: trade.isBuyer ? 'BUY' : 'SELL',
              tradePair: symbol,
              quoteAsset: quote,
              quoteAmount: parseFloat(String(trade.quoteQty)),
              rawData: trade as any,
            });
          }

          cursor[`fromId_${symbol}`] = trades[trades.length - 1].id + 1;
          this.logger.log(`${symbol}: ${trades.length} trades`);
        }
      } catch (error: any) {
        if (!error.message?.includes('Invalid symbol')) {
          this.logger.debug(`Failed to fetch trades for ${symbol}: ${error.message}`);
        }
      }

      processedSymbols.push(symbol);
      await this.delay(100);
    }

    cursor.processedSymbols = processedSymbols;
    return records;
  }

  // ---- Phase 1: Deposits ----
  private async fetchDepositHistory(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];
    const now = options.until ?? new Date();
    let windowEnd = cursor.depositsWindowEnd ?? now.getTime();
    const earliest = options.since?.getTime() ?? (now.getTime() - THREE_YEARS_MS);

    while (windowEnd > earliest) {
      const windowStart = Math.max(windowEnd - NINETY_DAYS_MS, earliest);
      let offset = 0;

      while (true) {
        const deposits = await this.client.getDepositHistory({
          startTime: windowStart,
          endTime: windowEnd,
          offset,
          limit: 1000,
          status: '1' as any,
        });

        if (!Array.isArray(deposits) || deposits.length === 0) break;

        for (const d of deposits) {
          records.push({
            externalId: `dep-${d.txId ?? (d as any).id ?? `${d.coin}-${d.insertTime}`}`,
            type: 'DEPOSIT',
            timestamp: new Date(d.insertTime),
            asset: d.coin,
            amount: parseFloat(String(d.amount)),
            network: d.network,
            txId: d.txId,
            rawData: d as any,
          });
        }

        if (deposits.length < 1000) break;
        offset += 1000;
      }

      windowEnd = windowStart;
      await this.delay(200);
    }

    cursor.depositsWindowEnd = earliest;
    return records;
  }

  // ---- Phase 1: Withdrawals ----
  private async fetchWithdrawalHistory(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];
    const now = options.until ?? new Date();
    let windowEnd = cursor.withdrawalsWindowEnd ?? now.getTime();
    const earliest = options.since?.getTime() ?? (now.getTime() - THREE_YEARS_MS);

    while (windowEnd > earliest) {
      const windowStart = Math.max(windowEnd - NINETY_DAYS_MS, earliest);
      let offset = 0;

      while (true) {
        const withdrawals = await this.client.getWithdrawHistory({
          startTime: windowStart,
          endTime: windowEnd,
          offset,
          limit: 1000,
          status: '6' as any,
        });

        if (!Array.isArray(withdrawals) || withdrawals.length === 0) break;

        for (const w of withdrawals) {
          records.push({
            externalId: `wd-${w.id}`,
            type: 'WITHDRAWAL',
            timestamp: new Date(w.applyTime),
            asset: w.coin,
            amount: parseFloat(String(w.amount)),
            feeAmount: parseFloat(String(w.transactionFee)),
            feeAsset: w.coin,
            network: w.network,
            txId: w.txId,
            rawData: w as any,
          });
        }

        if (withdrawals.length < 1000) break;
        offset += 1000;
      }

      windowEnd = windowStart;
      await this.delay(500);
    }

    cursor.withdrawalsWindowEnd = earliest;
    return records;
  }

  // ---- Phase 1: Fiat payments ----
  private async fetchFiatPayments(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    for (const transactionType of ['0', '1'] as const) {
      const isBuy = transactionType === '0';
      let page = cursor[`fiatPayments_${transactionType}_page`] ?? 1;
      let total = 0;

      while (true) {
        const response = await this.client.getFiatPaymentsHistory({
          transactionType,
          page,
          rows: 500,
          ...(options.since ? { beginTime: options.since.getTime() } : {}),
          ...(options.until ? { endTime: options.until.getTime() } : {}),
        });

        const data = (response as any).data;
        if (!Array.isArray(data) || data.length === 0) break;

        for (const p of data) {
          if (p.status !== 'Completed') continue;

          records.push({
            externalId: `fiat-${p.orderNo}`,
            type: isBuy ? 'FIAT_BUY' : 'FIAT_SELL',
            timestamp: new Date(p.createTime),
            asset: p.cryptoCurrency,
            amount: parseFloat(p.obtainAmount),
            priceUsd: parseFloat(p.price),
            totalValueUsd: parseFloat(p.sourceAmount),
            feeAmount: parseFloat(p.totalFee),
            feeAsset: p.fiatCurrency,
            side: isBuy ? 'BUY' : 'SELL',
            tradePair: `${p.cryptoCurrency}/${p.fiatCurrency}`,
            quoteAsset: p.fiatCurrency,
            quoteAmount: parseFloat(p.sourceAmount),
            rawData: { ...p, isFiatTransaction: true },
          });
        }

        total += data.length;
        if (total >= ((response as any).total ?? 0)) break;
        page++;
        await this.delay(200);
      }

      cursor[`fiatPayments_${transactionType}_page`] = page;
    }

    return records;
  }

  // ---- Phase 1: Fiat orders ----
  private async fetchFiatOrders(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    for (const transactionType of ['0', '1'] as const) {
      const isDeposit = transactionType === '0';
      let page = cursor[`fiatOrders_${transactionType}_page`] ?? 1;

      while (true) {
        const response = await this.client.getFiatOrderHistory({
          transactionType,
          page,
          rows: 500,
          ...(options.since ? { beginTime: options.since.getTime() } : {}),
          ...(options.until ? { endTime: options.until.getTime() } : {}),
        });

        const data = (response as any).data;
        if (!Array.isArray(data) || data.length === 0) break;

        for (const order of data) {
          if (order.status !== 'Successful') continue;

          records.push({
            externalId: `fiatorder-${order.orderNo}`,
            type: isDeposit ? 'DEPOSIT' : 'WITHDRAWAL',
            timestamp: new Date(order.createTime),
            asset: order.fiatCurrency,
            amount: parseFloat(order.amount),
            feeAmount: parseFloat(order.totalFee),
            feeAsset: order.fiatCurrency,
            rawData: { ...order, isFiatOrder: true },
          });
        }

        if (data.length < 500) break;
        page++;
        await this.delay(1000);
      }

      cursor[`fiatOrders_${transactionType}_page`] = page;
    }

    return records;
  }

  // ---- Phase 2: Convert history ----
  private async fetchConvertHistory(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    try {
      const now = options.until ?? new Date();
      let endTime = cursor.convertEndTime ?? now.getTime();
      const earliest = options.since?.getTime() ?? (now.getTime() - THREE_YEARS_MS);
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

      while (endTime > earliest) {
        let windowStart = Math.max(endTime - THIRTY_DAYS_MS, earliest);

        // Inner loop: narrow the window when a page is full (1000 records)
        let windowEnd = endTime;
        while (windowEnd > windowStart) {
          const response = await (this.client as any).getConvertTradeHistory({
            startTime: windowStart,
            endTime: windowEnd,
            limit: 1000,
          });

          const list = (response as any)?.list ?? response ?? [];
          if (Array.isArray(list)) {
            for (const c of list) {
              records.push({
                externalId: `convert-${c.orderId ?? c.quoteId}`,
                type: 'CONVERT',
                timestamp: new Date(c.createTime ?? c.orderTime),
                asset: c.fromAsset,
                amount: parseFloat(c.fromAmount),
                quoteAsset: c.toAsset,
                quoteAmount: parseFloat(c.toAmount),
                rawData: c,
              });
            }

            if (list.length >= 1000) {
              // Window is full — narrow to midpoint to get remaining records
              const midpoint = Math.floor((windowStart + windowEnd) / 2);
              if (midpoint <= windowStart) break; // can't narrow further
              this.logger.log(`Convert window full (1000 records), narrowing from ${new Date(windowEnd).toISOString()} to ${new Date(midpoint).toISOString()}`);
              windowEnd = midpoint;
              await this.delay(200);
              continue;
            }
          }

          break; // window fully fetched
        }

        endTime = windowStart;
        await this.delay(200);
      }

      cursor.convertEndTime = earliest;
    } catch (error: any) {
      this.logger.debug(`Convert history not available: ${error.message}`);
    }

    return records;
  }

  // ---- Phase 2: Dust log ----
  private async fetchDustLog(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    try {
      // Binance dust log supports pagination: total + rows per page
      const now = options.until ?? new Date();
      let windowEnd = cursor.dustWindowEnd ?? now.getTime();
      const earliest = options.since?.getTime() ?? (now.getTime() - THREE_YEARS_MS);

      while (windowEnd > earliest) {
        const windowStart = Math.max(windowEnd - NINETY_DAYS_MS, earliest);

        const response = await (this.client as any).getDustLog({
          startTime: windowStart,
          endTime: windowEnd,
        });

        const results = (response as any)?.userAssetDribblets ?? response?.results ?? [];
        if (Array.isArray(results)) {
          for (const entry of results) {
            const details = entry.userAssetDribbletDetails ?? entry.logs ?? [];
            for (const d of details) {
              records.push({
                externalId: `dust-${d.tranId ?? d.transId}`,
                type: 'DUST_CONVERT',
                timestamp: new Date(entry.operateTime ?? entry.transactionTime),
                asset: d.fromAsset,
                amount: parseFloat(d.amount),
                quoteAsset: 'BNB',
                quoteAmount: parseFloat(d.transferedAmount ?? d.serviceChargeAmount ?? '0'),
                feeAmount: parseFloat(d.serviceChargeAmount ?? '0'),
                feeAsset: 'BNB',
                rawData: d,
              });
            }
          }
        }

        windowEnd = windowStart;
        await this.delay(200);
      }

      cursor.dustWindowEnd = earliest;
    } catch (error: any) {
      this.logger.debug(`Dust log not available: ${error.message}`);
    }

    return records;
  }

  // ---- Phase 2: C2C (P2P) trades ----
  private async fetchC2CHistory(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    try {
      for (const tradeType of ['BUY', 'SELL'] as const) {
        let page = cursor[`c2c_${tradeType}_page`] ?? 1;

        while (true) {
          const response = await (this.client as any).getC2CTradeHistory({
            tradeType,
            page,
            rows: 100,
            ...(options.since ? { startTimestamp: options.since.getTime() } : {}),
            ...(options.until ? { endTimestamp: options.until.getTime() } : {}),
          });

          const data = (response as any)?.data ?? [];
          if (!Array.isArray(data) || data.length === 0) break;

          for (const trade of data) {
            records.push({
              externalId: `c2c-${trade.orderNumber}`,
              type: 'C2C_TRADE',
              timestamp: new Date(trade.createTime),
              asset: trade.asset,
              amount: parseFloat(trade.amount),
              totalValueUsd: parseFloat(trade.totalPrice),
              priceUsd: parseFloat(trade.unitPrice),
              side: tradeType,
              tradePair: `${trade.asset}/${trade.fiat}`,
              quoteAsset: trade.fiat,
              quoteAmount: parseFloat(trade.totalPrice),
              isP2P: true,
              rawData: trade,
            });
          }

          if (data.length < 100) break;
          page++;
          await this.delay(200);
        }

        cursor[`c2c_${tradeType}_page`] = page;
      }
    } catch (error: any) {
      this.logger.debug(`C2C history not available: ${error.message}`);
    }

    return records;
  }

  // ---- Phase 3: ETH Staking ----
  private async fetchEthStaking(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    try {
      // ETH staking subscriptions
      const stakingResponse = await (this.client as any).getEthStakingHistory({
        ...(options.since ? { startTime: options.since.getTime() } : {}),
        ...(options.until ? { endTime: options.until.getTime() } : {}),
      });
      const stakingRows = (stakingResponse as any)?.rows ?? stakingResponse ?? [];
      if (Array.isArray(stakingRows)) {
        for (const s of stakingRows) {
          records.push({
            externalId: `ethstake-${s.time ?? Date.now()}`,
            type: 'STAKE',
            timestamp: new Date(s.time),
            asset: 'ETH',
            amount: parseFloat(s.amount),
            quoteAsset: 'BETH',
            quoteAmount: parseFloat(s.amount), // 1:1 ratio
            rawData: s,
          });
        }
      }
    } catch (error: any) {
      this.logger.debug(`ETH staking history not available: ${error.message}`);
    }

    try {
      // ETH staking redemptions
      const redeemResponse = await (this.client as any).getEthRedemptionHistory({
        ...(options.since ? { startTime: options.since.getTime() } : {}),
        ...(options.until ? { endTime: options.until.getTime() } : {}),
      });
      const redeemRows = (redeemResponse as any)?.rows ?? redeemResponse ?? [];
      if (Array.isArray(redeemRows)) {
        for (const r of redeemRows) {
          records.push({
            externalId: `ethunstake-${r.time ?? Date.now()}`,
            type: 'UNSTAKE',
            timestamp: new Date(r.time ?? r.arrivalTime),
            asset: 'ETH',
            amount: parseFloat(r.amount),
            quoteAsset: 'BETH',
            quoteAmount: parseFloat(r.amount),
            rawData: r,
          });
        }
      }
    } catch (error: any) {
      this.logger.debug(`ETH redemption history not available: ${error.message}`);
    }

    try {
      // BETH rewards
      const rewardsResponse = await (this.client as any).getBethRewardsHistory({
        ...(options.since ? { startTime: options.since.getTime() } : {}),
        ...(options.until ? { endTime: options.until.getTime() } : {}),
      });
      const rewardsRows = (rewardsResponse as any)?.rows ?? rewardsResponse ?? [];
      if (Array.isArray(rewardsRows)) {
        for (const r of rewardsRows) {
          records.push({
            externalId: `bethreward-${r.time ?? Date.now()}`,
            type: 'INTEREST',
            timestamp: new Date(r.time),
            asset: 'BETH',
            amount: parseFloat(r.amount ?? r.reward),
            rawData: r,
          });
        }
      }
    } catch (error: any) {
      this.logger.debug(`BETH rewards not available: ${error.message}`);
    }

    return records;
  }

  // ---- Phase 3: SOL Staking ----
  private async fetchSolStaking(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    try {
      const stakingResponse = await (this.client as any).getSolStakingHistory?.({
        ...(options.since ? { startTime: options.since.getTime() } : {}),
        ...(options.until ? { endTime: options.until.getTime() } : {}),
      });
      const stakingRows = (stakingResponse as any)?.rows ?? [];
      if (Array.isArray(stakingRows)) {
        for (const s of stakingRows) {
          records.push({
            externalId: `solstake-${s.time ?? Date.now()}`,
            type: 'STAKE',
            timestamp: new Date(s.time),
            asset: 'SOL',
            amount: parseFloat(s.amount),
            quoteAsset: 'BNSOL',
            quoteAmount: parseFloat(s.amount),
            rawData: s,
          });
        }
      }
    } catch (error: any) {
      this.logger.debug(`SOL staking not available: ${error.message}`);
    }

    try {
      const rewardsResponse = await (this.client as any).getBnsolRewardsHistory?.({
        ...(options.since ? { startTime: options.since.getTime() } : {}),
        ...(options.until ? { endTime: options.until.getTime() } : {}),
      });
      const rewardsRows = (rewardsResponse as any)?.rows ?? [];
      if (Array.isArray(rewardsRows)) {
        for (const r of rewardsRows) {
          records.push({
            externalId: `bnsolreward-${r.time ?? Date.now()}`,
            type: 'INTEREST',
            timestamp: new Date(r.time),
            asset: 'BNSOL',
            amount: parseFloat(r.amount ?? r.reward),
            rawData: r,
          });
        }
      }
    } catch (error: any) {
      this.logger.debug(`BNSOL rewards not available: ${error.message}`);
    }

    return records;
  }

  // ---- Phase 3: Flexible Earn (Simple Earn) — windowed + paginated ----
  private async fetchFlexibleEarn(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];
    const now = options.until ?? new Date();
    const earliest = options.since?.getTime() ?? (now.getTime() - THREE_YEARS_MS);

    // Flexible subscriptions (90-day windows + page pagination)
    try {
      let windowEnd = cursor.flexSubWindowEnd ?? now.getTime();
      while (windowEnd > earliest) {
        const windowStart = Math.max(windowEnd - NINETY_DAYS_MS, earliest);
        let page = 1;
        while (true) {
          const subResponse = await (this.client as any).getFlexibleSubscriptionRecord?.({
            startTime: windowStart, endTime: windowEnd, size: 100, current: page,
          });
          const subRows = (subResponse as any)?.rows ?? [];
          if (!Array.isArray(subRows) || subRows.length === 0) break;
          for (const s of subRows) {
            records.push({
              externalId: `flexsub-${s.purchaseId ?? s.time ?? Date.now()}`,
              type: 'STAKE',
              timestamp: new Date(s.time ?? s.createTime),
              asset: s.asset,
              amount: parseFloat(s.amount),
              rawData: s,
            });
          }
          if (subRows.length < 100) break;
          page++;
          await this.delay(200);
        }
        windowEnd = windowStart;
        await this.delay(100);
      }
      cursor.flexSubWindowEnd = earliest;
    } catch (error: any) {
      this.logger.debug(`Flexible subscription not available: ${error.message}`);
    }

    // Flexible redemptions (90-day windows + page pagination)
    try {
      let windowEnd = cursor.flexRedWindowEnd ?? now.getTime();
      while (windowEnd > earliest) {
        const windowStart = Math.max(windowEnd - NINETY_DAYS_MS, earliest);
        let page = 1;
        while (true) {
          const redResponse = await (this.client as any).getFlexibleRedemptionRecord?.({
            startTime: windowStart, endTime: windowEnd, size: 100, current: page,
          });
          const redRows = (redResponse as any)?.rows ?? [];
          if (!Array.isArray(redRows) || redRows.length === 0) break;
          for (const r of redRows) {
            records.push({
              externalId: `flexred-${r.redeemId ?? r.time ?? Date.now()}`,
              type: 'UNSTAKE',
              timestamp: new Date(r.time ?? r.createTime),
              asset: r.asset,
              amount: parseFloat(r.amount),
              rawData: r,
            });
          }
          if (redRows.length < 100) break;
          page++;
          await this.delay(200);
        }
        windowEnd = windowStart;
        await this.delay(100);
      }
      cursor.flexRedWindowEnd = earliest;
    } catch (error: any) {
      this.logger.debug(`Flexible redemption not available: ${error.message}`);
    }

    // Flexible rewards (90-day windows + page pagination, multiple reward types)
    for (const rewardType of ['BONUS', 'REALTIME', 'REWARDS'] as const) {
      try {
        let windowEnd = cursor[`flexReward_${rewardType}_windowEnd`] ?? now.getTime();
        while (windowEnd > earliest) {
          const windowStart = Math.max(windowEnd - NINETY_DAYS_MS, earliest);
          let page = 1;
          while (true) {
            const rewardResponse = await (this.client as any).getFlexibleRewardsHistory?.({
              type: rewardType, startTime: windowStart, endTime: windowEnd, size: 100, current: page,
            });
            const rewardRows = (rewardResponse as any)?.rows ?? [];
            if (!Array.isArray(rewardRows) || rewardRows.length === 0) break;
            for (const r of rewardRows) {
              records.push({
                externalId: `flexreward-${rewardType}-${r.id ?? r.time ?? Date.now()}`,
                type: 'INTEREST',
                timestamp: new Date(r.time ?? r.createTime),
                asset: r.asset ?? r.rewards?.[0]?.asset,
                amount: parseFloat(r.amount ?? r.rewards?.[0]?.amount ?? '0'),
                rawData: r,
              });
            }
            if (rewardRows.length < 100) break;
            page++;
            await this.delay(200);
          }
          windowEnd = windowStart;
          await this.delay(100);
        }
        cursor[`flexReward_${rewardType}_windowEnd`] = earliest;
      } catch (error: any) {
        this.logger.debug(`Flexible ${rewardType} rewards not available: ${error.message}`);
      }
    }

    return records;
  }

  // ---- Phase 3: Locked Earn (Simple Earn) — windowed + paginated ----
  private async fetchLockedEarn(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];
    const now = options.until ?? new Date();
    const earliest = options.since?.getTime() ?? (now.getTime() - THREE_YEARS_MS);

    // Locked subscriptions (90-day windows + page pagination)
    try {
      let windowEnd = cursor.lockSubWindowEnd ?? now.getTime();
      while (windowEnd > earliest) {
        const windowStart = Math.max(windowEnd - NINETY_DAYS_MS, earliest);
        let page = 1;
        while (true) {
          const subResponse = await (this.client as any).getLockedSubscriptionRecord?.({
            startTime: windowStart, endTime: windowEnd, size: 100, current: page,
          });
          const subRows = (subResponse as any)?.rows ?? [];
          if (!Array.isArray(subRows) || subRows.length === 0) break;
          for (const s of subRows) {
            records.push({
              externalId: `locksub-${s.purchaseId ?? s.time ?? Date.now()}`,
              type: 'STAKE',
              timestamp: new Date(s.time ?? s.createTime),
              asset: s.asset,
              amount: parseFloat(s.amount),
              rawData: s,
            });
          }
          if (subRows.length < 100) break;
          page++;
          await this.delay(200);
        }
        windowEnd = windowStart;
        await this.delay(100);
      }
      cursor.lockSubWindowEnd = earliest;
    } catch (error: any) {
      this.logger.debug(`Locked subscription not available: ${error.message}`);
    }

    // Locked redemptions (90-day windows + page pagination)
    try {
      let windowEnd = cursor.lockRedWindowEnd ?? now.getTime();
      while (windowEnd > earliest) {
        const windowStart = Math.max(windowEnd - NINETY_DAYS_MS, earliest);
        let page = 1;
        while (true) {
          const redResponse = await (this.client as any).getLockedRedemptionRecord?.({
            startTime: windowStart, endTime: windowEnd, size: 100, current: page,
          });
          const redRows = (redResponse as any)?.rows ?? [];
          if (!Array.isArray(redRows) || redRows.length === 0) break;
          for (const r of redRows) {
            records.push({
              externalId: `lockred-${r.redeemId ?? r.time ?? Date.now()}`,
              type: 'UNSTAKE',
              timestamp: new Date(r.time ?? r.createTime),
              asset: r.asset,
              amount: parseFloat(r.amount),
              rawData: r,
            });
          }
          if (redRows.length < 100) break;
          page++;
          await this.delay(200);
        }
        windowEnd = windowStart;
        await this.delay(100);
      }
      cursor.lockRedWindowEnd = earliest;
    } catch (error: any) {
      this.logger.debug(`Locked redemption not available: ${error.message}`);
    }

    // Locked rewards (90-day windows + page pagination)
    try {
      let windowEnd = cursor.lockRewardWindowEnd ?? now.getTime();
      while (windowEnd > earliest) {
        const windowStart = Math.max(windowEnd - NINETY_DAYS_MS, earliest);
        let page = 1;
        while (true) {
          const rewardResponse = await (this.client as any).getLockedRewardsHistory?.({
            startTime: windowStart, endTime: windowEnd, size: 100, current: page,
          });
          const rewardRows = (rewardResponse as any)?.rows ?? [];
          if (!Array.isArray(rewardRows) || rewardRows.length === 0) break;
          for (const r of rewardRows) {
            records.push({
              externalId: `lockreward-${r.id ?? r.time ?? Date.now()}`,
              type: 'INTEREST',
              timestamp: new Date(r.time ?? r.createTime),
              asset: r.asset ?? r.rewards?.[0]?.asset,
              amount: parseFloat(r.amount ?? r.rewards?.[0]?.amount ?? '0'),
              rawData: r,
            });
          }
          if (rewardRows.length < 100) break;
          page++;
          await this.delay(200);
        }
        windowEnd = windowStart;
        await this.delay(100);
      }
      cursor.lockRewardWindowEnd = earliest;
    } catch (error: any) {
      this.logger.debug(`Locked rewards not available: ${error.message}`);
    }

    return records;
  }

  // ---- Phase 4: Margin capital flow ----
  private async fetchMarginCapitalFlow(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    try {
      const response = await (this.client as any).getMarginCapitalFlow?.({
        ...(options.since ? { startTime: options.since.getTime() } : {}),
        ...(options.until ? { endTime: options.until.getTime() } : {}),
        size: 100,
      });
      const rows = (response as any)?.rows ?? response ?? [];
      if (Array.isArray(rows)) {
        for (const row of rows) {
          const flowType = String(row.type).toUpperCase();
          let recordType: ExchangeRecord['type'] = 'TRADE';
          if (flowType.includes('BORROW')) recordType = 'MARGIN_BORROW';
          else if (flowType.includes('REPAY')) recordType = 'MARGIN_REPAY';
          else if (flowType.includes('INTEREST')) recordType = 'MARGIN_INTEREST';
          else if (flowType.includes('LIQUIDATION')) recordType = 'MARGIN_LIQUIDATION';

          records.push({
            externalId: `margin-${row.id ?? row.tranId ?? Date.now()}`,
            type: recordType,
            timestamp: new Date(row.timestamp ?? row.time),
            asset: row.asset,
            amount: Math.abs(parseFloat(row.amount)),
            rawData: row,
          });
        }
      }
    } catch (error: any) {
      this.logger.debug(`Margin capital flow not available: ${error.message}`);
    }

    return records;
  }

  // ---- Phase 4: Margin interest ----
  private async fetchMarginInterest(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    try {
      const response = await (this.client as any).getMarginInterestHistory?.({
        ...(options.since ? { startTime: options.since.getTime() } : {}),
        ...(options.until ? { endTime: options.until.getTime() } : {}),
        size: 100,
      });
      const rows = (response as any)?.rows ?? response ?? [];
      if (Array.isArray(rows)) {
        for (const row of rows) {
          records.push({
            externalId: `marginint-${row.interestAccuredTime ?? Date.now()}`,
            type: 'MARGIN_INTEREST',
            timestamp: new Date(row.interestAccuredTime ?? row.time),
            asset: row.asset,
            amount: parseFloat(row.interest),
            rawData: row,
          });
        }
      }
    } catch (error: any) {
      this.logger.debug(`Margin interest not available: ${error.message}`);
    }

    return records;
  }

  // ---- Phase 4: Margin borrow/repay ----
  private async fetchMarginBorrowRepay(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    try {
      for (const type of ['BORROW', 'REPAY'] as const) {
        const response = await (this.client as any).getMarginAccountBorrowRepayRecords?.({
          type,
          ...(options.since ? { startTime: options.since.getTime() } : {}),
          ...(options.until ? { endTime: options.until.getTime() } : {}),
          size: 100,
        });
        const rows = (response as any)?.rows ?? response ?? [];
        if (Array.isArray(rows)) {
          for (const row of rows) {
            records.push({
              externalId: `margin${type.toLowerCase()}-${row.txId ?? row.tranId ?? Date.now()}`,
              type: type === 'BORROW' ? 'MARGIN_BORROW' : 'MARGIN_REPAY',
              timestamp: new Date(row.timestamp ?? row.time),
              asset: row.asset,
              amount: parseFloat(row.amount ?? row.principal),
              rawData: row,
            });
          }
        }
      }
    } catch (error: any) {
      this.logger.debug(`Margin borrow/repay not available: ${error.message}`);
    }

    return records;
  }

  // ---- Phase 4: Mining earnings ----
  private async fetchMiningEarnings(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    try {
      const response = await (this.client as any).getMiningEarnings?.({
        algo: 'sha256',
        userName: '', // needs to be set by user
        ...(options.since ? { startDate: Math.floor(options.since.getTime() / 1000) } : {}),
        ...(options.until ? { endDate: Math.floor(options.until.getTime() / 1000) } : {}),
      });
      const data = (response as any)?.data?.accountProfits ?? [];
      if (Array.isArray(data)) {
        for (const d of data) {
          records.push({
            externalId: `mining-${d.time ?? Date.now()}`,
            type: 'MINING',
            timestamp: new Date(d.time),
            asset: d.coinName ?? 'BTC',
            amount: parseFloat(d.profitAmount ?? '0'),
            rawData: d,
          });
        }
      }
    } catch (error: any) {
      this.logger.debug(`Mining earnings not available: ${error.message}`);
    }

    return records;
  }

  // ---- Phase 4: Crypto loans ----
  private async fetchCryptoLoans(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    try {
      // Flexible loan borrow history
      const borrowResponse = await (this.client as any).getLoanFlexibleBorrowHistory?.({
        ...(options.since ? { startTime: options.since.getTime() } : {}),
        ...(options.until ? { endTime: options.until.getTime() } : {}),
        limit: 100,
      });
      const borrowRows = (borrowResponse as any)?.rows ?? [];
      if (Array.isArray(borrowRows)) {
        for (const b of borrowRows) {
          records.push({
            externalId: `loanborrow-${b.loanCoin ?? ''}-${b.borrowTime ?? Date.now()}`,
            type: 'MARGIN_BORROW',
            timestamp: new Date(b.borrowTime ?? b.time),
            asset: b.loanCoin ?? b.loanAsset,
            amount: parseFloat(b.loanAmount ?? b.amount ?? '0'),
            rawData: b,
          });
        }
      }
    } catch (error: any) {
      this.logger.debug(`Loan borrow not available: ${error.message}`);
    }

    try {
      // Flexible loan repay history
      const repayResponse = await (this.client as any).getLoanFlexibleRepaymentHistory?.({
        ...(options.since ? { startTime: options.since.getTime() } : {}),
        ...(options.until ? { endTime: options.until.getTime() } : {}),
        limit: 100,
      });
      const repayRows = (repayResponse as any)?.rows ?? [];
      if (Array.isArray(repayRows)) {
        for (const r of repayRows) {
          records.push({
            externalId: `loanrepay-${r.repayAmount ?? ''}-${r.repayTime ?? Date.now()}`,
            type: 'MARGIN_REPAY',
            timestamp: new Date(r.repayTime ?? r.time),
            asset: r.loanCoin ?? r.loanAsset,
            amount: parseFloat(r.repayAmount ?? r.amount ?? '0'),
            rawData: r,
          });
        }
      }
    } catch (error: any) {
      this.logger.debug(`Loan repay not available: ${error.message}`);
    }

    try {
      // Crypto loans income history (interest + liquidation)
      const incomeResponse = await (this.client as any).getCryptoLoansIncomeHistory?.({
        ...(options.since ? { startTime: options.since.getTime() } : {}),
        ...(options.until ? { endTime: options.until.getTime() } : {}),
        limit: 100,
      });
      const incomeRows = (incomeResponse as any)?.rows ?? incomeResponse ?? [];
      if (Array.isArray(incomeRows)) {
        for (const i of incomeRows) {
          const incomeType = String(i.type).toUpperCase();
          let recordType: ExchangeRecord['type'] = 'MARGIN_INTEREST';
          if (incomeType.includes('LIQUIDATION')) recordType = 'MARGIN_LIQUIDATION';

          records.push({
            externalId: `loanincome-${i.tranId ?? i.time ?? Date.now()}`,
            type: recordType,
            timestamp: new Date(i.time ?? i.createTime),
            asset: i.asset,
            amount: Math.abs(parseFloat(i.amount ?? '0')),
            rawData: i,
          });
        }
      }
    } catch (error: any) {
      this.logger.debug(`Loan income not available: ${error.message}`);
    }

    return records;
  }

  // ---- Phase 3: Asset Dividends (airdrops, staking distributions) ----
  private async fetchAssetDividends(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];
    const now = options.until ?? new Date();
    const earliest = options.since?.getTime() ?? (now.getTime() - THREE_YEARS_MS);
    const ONE_HUNDRED_SEVENTY_DAYS_MS = 170 * 24 * 60 * 60 * 1000; // slightly under 180-day API limit

    try {
      let windowEnd = cursor.dividendsWindowEnd ?? now.getTime();
      while (windowEnd > earliest) {
        const windowStart = Math.max(windowEnd - ONE_HUNDRED_SEVENTY_DAYS_MS, earliest);
        let offset = 0;

        while (true) {
          const resp = await (this.client as any).getAssetDividendRecord?.({
            startTime: windowStart, endTime: windowEnd, limit: 500, offset,
          });
          const rows = (resp as any)?.rows ?? [];
          if (!Array.isArray(rows) || rows.length === 0) break;

          for (const d of rows) {
            const asset = d.asset ?? d.enInfo?.asset;
            const amount = parseFloat(d.amount ?? '0');
            if (!asset || amount === 0) continue;

            records.push({
              externalId: `div-${d.id ?? d.tranId ?? `${asset}-${d.divTime}`}`,
              type: 'DIVIDEND',
              timestamp: new Date(d.divTime ?? d.time),
              asset,
              amount,
              rawData: d,
            });
          }

          if (rows.length < 500) break;
          offset += 500;
          await this.delay(200);
        }

        windowEnd = windowStart;
        await this.delay(100);
      }
      cursor.dividendsWindowEnd = earliest;
    } catch (error: any) {
      this.logger.debug(`Asset dividends not available: ${error.message}`);
    }

    return records;
  }

  // ===== Real-time balance fetching (spot + earn + margin + futures + funding) =====

  async fetchRealTimeBalances(): Promise<{ asset: string; free: number; locked: number; source: string }[]> {
    const balances: { asset: string; free: number; locked: number; source: string }[] = [];

    // Spot account
    try {
      const account = await this.client.getAccountInformation();
      for (const b of account.balances) {
        const asset = (b as any).asset as string;
        // Skip LD-prefixed tokens — they're Binance's internal representation
        // of Flexible Earn positions shown in spot. The actual earn balances
        // are fetched separately from the earn_flexible endpoint below.
        if (asset.startsWith('LD')) continue;
        const free = parseFloat((b as any).free);
        const locked = parseFloat((b as any).locked);
        if (free > 0 || locked > 0) {
          balances.push({ asset, free, locked, source: 'spot' });
        }
      }
    } catch (error: any) {
      this.logger.debug(`Spot balance not available: ${error.message}`);
    }

    // Flexible Earn positions
    try {
      const flexPositions = await (this.client as any).getFlexibleProductPosition?.({});
      const rows = (flexPositions as any)?.rows ?? flexPositions ?? [];
      if (Array.isArray(rows)) {
        for (const p of rows) {
          const amount = parseFloat(p.totalAmount ?? p.freeAmount ?? '0');
          if (amount > 0) {
            balances.push({ asset: p.asset, free: amount, locked: 0, source: 'earn_flexible' });
          }
        }
      }
    } catch (error: any) {
      this.logger.debug(`Flexible earn positions not available: ${error.message}`);
    }

    // Locked Earn positions
    try {
      const lockedPositions = await (this.client as any).getLockedProductPosition?.({});
      const rows = (lockedPositions as any)?.rows ?? lockedPositions ?? [];
      if (Array.isArray(rows)) {
        for (const p of rows) {
          const amount = parseFloat(p.amount ?? '0');
          if (amount > 0) {
            balances.push({ asset: p.asset, free: 0, locked: amount, source: 'earn_locked' });
          }
        }
      }
    } catch (error: any) {
      this.logger.debug(`Locked earn positions not available: ${error.message}`);
    }

    // Margin account
    try {
      const marginInfo = await (this.client as any).getMarginAccountInfo?.();
      const assets = (marginInfo as any)?.userAssets ?? [];
      if (Array.isArray(assets)) {
        for (const a of assets) {
          const free = parseFloat(a.free ?? '0');
          const locked = parseFloat(a.locked ?? '0');
          if (free > 0 || locked > 0) {
            balances.push({ asset: a.asset, free, locked, source: 'margin' });
          }
        }
      }
    } catch (error: any) {
      this.logger.debug(`Margin balance not available: ${error.message}`);
    }

    // Futures (USDT-M)
    try {
      const futuresAccount = await (this.client as any).getBalance?.();
      if (Array.isArray(futuresAccount)) {
        for (const a of futuresAccount) {
          const balance = parseFloat(a.balance ?? '0');
          if (balance > 0) {
            balances.push({ asset: a.asset, free: balance, locked: 0, source: 'futures' });
          }
        }
      }
    } catch (error: any) {
      this.logger.debug(`Futures balance not available: ${error.message}`);
    }

    // Funding wallet
    try {
      const funding = await (this.client as any).getFundingAsset?.({});
      if (Array.isArray(funding)) {
        for (const a of funding) {
          const free = parseFloat(a.free ?? '0');
          const locked = parseFloat(a.locked ?? '0');
          const frozen = parseFloat(a.freeze ?? '0');
          if (free > 0 || locked > 0 || frozen > 0) {
            balances.push({ asset: a.asset, free, locked: locked + frozen, source: 'funding' });
          }
        }
      }
    } catch (error: any) {
      this.logger.debug(`Funding balance not available: ${error.message}`);
    }

    return balances;
  }

  // ===== Deposit address discovery =====

  async fetchDepositAddresses(): Promise<{ coin: string; network: string; address: string; tag?: string }[]> {
    const addresses: { coin: string; network: string; address: string; tag?: string }[] = [];

    try {
      // Get all coins with their networks
      const coinInfo = await this.client.getBalances();

      for (const coin of coinInfo) {
        for (const net of coin.networkList ?? []) {
          if (!net.depositEnable) continue;

          try {
            await this.delay(100); // rate limit
            const result = await this.client.getDepositAddress({
              coin: coin.coin,
              network: net.network,
            });

            if (result?.address) {
              addresses.push({
                coin: coin.coin,
                network: net.network,
                address: result.address,
                tag: result.tag || undefined,
              });
            }
          } catch {
            // Some coins may not have deposit enabled
          }
        }
      }
    } catch (error: any) {
      this.logger.warn(`Failed to fetch deposit addresses: ${error.message}`);

      // Fallback: extract from deposit history rawData
      // (handled by caller)
    }

    this.logger.log(`Fetched ${addresses.length} deposit addresses`);
    return addresses;
  }

  // ======== UTILITIES ========

  private parseSymbol(symbol: string): { base: string; quote: string } {
    const knownQuotes = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'BTC', 'ETH', 'BNB', 'BRL', 'EUR', 'USD', 'TRY'];
    for (const q of knownQuotes) {
      if (symbol.endsWith(q)) {
        return { base: symbol.slice(0, -q.length), quote: q };
      }
    }
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
