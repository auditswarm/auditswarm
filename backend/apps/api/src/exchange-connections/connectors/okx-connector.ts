import { Logger } from '@nestjs/common';
import { RestClient } from 'okx-api';
import {
  ExchangeApiConnector,
  SyncOptions,
  SyncResult,
  SyncPhaseResult,
  ConnectionTestResult,
} from './base-connector';
import { ExchangeRecord } from '../../exchange-imports/adapters/base-adapter';

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export class OkxConnector implements ExchangeApiConnector {
  readonly exchangeName = 'okx';
  private readonly logger = new Logger(OkxConnector.name);
  private client: RestClient;

  constructor(apiKey: string, apiSecret: string, passphrase: string) {
    this.client = new RestClient({
      apiKey,
      apiSecret,
      apiPass: passphrase,
    });
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const configs = await this.client.getAccountConfiguration();
      if (!configs || configs.length === 0) {
        return { valid: false, permissions: [], error: 'No account config returned' };
      }

      const config = configs[0];
      const permissions: string[] = ['READ'];

      const perm = (config as any).perm ?? '';
      if (perm.includes('trade')) permissions.push('TRADE');
      if (perm.includes('withdraw')) permissions.push('WITHDRAW');

      return {
        valid: true,
        permissions,
        accountId: String((config as any).uid ?? ''),
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
    // OKX has no public P2P/fiat API
    return { records: [] };
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

    await this.safeRun('deposits', errors, async () => {
      const depositRecords = await this.fetchDepositHistory(options, cursor);
      records.push(...depositRecords);
    });

    await this.safeRun('withdrawals', errors, async () => {
      const withdrawalRecords = await this.fetchWithdrawalHistory(options, cursor);
      records.push(...withdrawalRecords);
    });

    await this.safeRun('trades', errors, async () => {
      const tradeRecords = await this.fetchSpotTrades(options, cursor);
      records.push(...tradeRecords);
    });

    return { phase: 1, records, cursor, errors };
  }

  // ===== PHASE 2: Conversions =====

  async fetchPhase2(options: SyncOptions): Promise<SyncPhaseResult> {
    const records: ExchangeRecord[] = [];
    const cursor = { ...(options.cursor ?? {}) };
    const errors: SyncPhaseResult['errors'] = [];

    await this.safeRun('convert', errors, async () => {
      const convertRecords = await this.fetchConvertHistory(options, cursor);
      records.push(...convertRecords);
    });

    await this.safeRun('easyConvert', errors, async () => {
      const dustRecords = await this.fetchEasyConvertHistory(options, cursor);
      records.push(...dustRecords);
    });

    // Bills-based converts (type=30) — catches converts that don't appear in getConvertHistory
    await this.safeRun('billConverts', errors, async () => {
      const billConvertRecords = await this.fetchBillConverts(options, cursor);
      records.push(...billConvertRecords);
    });

    return { phase: 2, records, cursor, errors };
  }

  // ===== PHASE 3: Passive Income (staking, savings, ETH/SOL staking) =====

  async fetchPhase3(options: SyncOptions): Promise<SyncPhaseResult> {
    const records: ExchangeRecord[] = [];
    const cursor = { ...(options.cursor ?? {}) };
    const errors: SyncPhaseResult['errors'] = [];

    await this.safeRun('stakingOrders', errors, async () => {
      const stakingRecords = await this.fetchStakingOrderHistory(options, cursor);
      records.push(...stakingRecords);
    });

    await this.safeRun('lendingHistory', errors, async () => {
      const lendingRecords = await this.fetchLendingHistory(options, cursor);
      records.push(...lendingRecords);
    });

    await this.safeRun('ethStaking', errors, async () => {
      const ethRecords = await this.fetchETHStakingHistory(options, cursor);
      records.push(...ethRecords);
    });

    return { phase: 3, records, cursor, errors };
  }

  // ===== PHASE 4: Advanced (margin, derivatives, bills) =====

  async fetchPhase4(options: SyncOptions): Promise<SyncPhaseResult> {
    const records: ExchangeRecord[] = [];
    const cursor = { ...(options.cursor ?? {}) };
    const errors: SyncPhaseResult['errors'] = [];

    await this.safeRun('marginTrades', errors, async () => {
      const marginRecords = await this.fetchMarginTrades(options, cursor);
      records.push(...marginRecords);
    });

    await this.safeRun('swapTrades', errors, async () => {
      const swapRecords = await this.fetchSwapTrades(options, cursor);
      records.push(...swapRecords);
    });

    await this.safeRun('billsArchive', errors, async () => {
      const billRecords = await this.fetchBillsArchive(options, cursor);
      records.push(...billRecords);
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
    const seen = new Set<string>();
    let afterTs: string | undefined = cursor.depositAfter;

    while (true) {
      await this.delay(200);
      const params: any = { limit: '100' };
      if (afterTs) params.after = afterTs;

      const deposits = await this.client.getDepositHistory(params);
      if (!deposits || deposits.length === 0) break;

      for (const d of deposits) {
        // state 2 = successful
        if (d.state !== '2') continue;

        const amount = parseFloat(d.amt);
        if (amount <= 0) continue;

        const key = d.depId || `${d.ts}-${d.ccy}-${d.amt}`;
        if (seen.has(key)) continue;
        seen.add(key);

        records.push({
          externalId: d.depId || `okx-deposit-${d.ts}-${d.ccy}`,
          type: 'DEPOSIT',
          timestamp: new Date(parseInt(d.ts, 10)),
          asset: d.ccy,
          amount,
          network: d.chain,
          txId: d.txId || undefined,
          rawData: d as any,
        });
      }

      // OKX returns newest first; after = oldest ts in batch to go further back
      const oldestTs = deposits[deposits.length - 1].ts;
      if (afterTs === oldestTs) break;
      afterTs = oldestTs;
      cursor.depositAfter = afterTs;

      if (deposits.length < 100) break;
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
    const seen = new Set<string>();
    let afterTs: string | undefined = cursor.withdrawalAfter;

    while (true) {
      await this.delay(200);
      const params: any = { limit: '100' };
      if (afterTs) params.after = afterTs;

      const withdrawals = await this.client.getWithdrawalHistory(params);
      if (!withdrawals || (withdrawals as any[]).length === 0) break;

      const list = withdrawals as any[];
      for (const w of list) {
        // state: various success states
        const state = String(w.state ?? '');
        if (!['2', '7', '10'].includes(state)) continue;

        const amount = parseFloat(w.amt);
        if (amount <= 0) continue;

        const key = w.wdId || `${w.ts}-${w.ccy}-${w.amt}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const fee = parseFloat(w.fee ?? '0');
        records.push({
          externalId: w.wdId || `okx-withdraw-${w.ts}-${w.ccy}`,
          type: 'WITHDRAWAL',
          timestamp: new Date(parseInt(String(w.ts), 10)),
          asset: w.ccy,
          amount,
          feeAmount: fee > 0 ? fee : undefined,
          feeAsset: fee > 0 ? w.feeCcy || w.ccy : undefined,
          network: w.chain,
          txId: w.txId || undefined,
          rawData: w as any,
        });
      }

      const oldestTs = list[list.length - 1].ts;
      if (afterTs === oldestTs) break;
      afterTs = oldestTs;
      cursor.withdrawalAfter = afterTs;

      if (list.length < 100) break;
    }

    this.logger.log(`Fetched ${records.length} withdrawals`);
    return records;
  }

  // ---- Phase 1: Spot trades (3 month limit) ----
  private async fetchSpotTrades(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];
    let afterBillId: string | undefined = cursor.spotTradesAfter;

    while (true) {
      await this.delay(250);
      const params: any = { instType: 'SPOT', limit: '100' };
      if (afterBillId) params.after = afterBillId;

      const fills = await this.client.getFillsHistory(params);
      if (!fills || fills.length === 0) break;

      for (const f of fills) {
        const { base, quote } = this.parseSymbol(f.instId);
        const fillSz = parseFloat(f.fillSz);
        const fillPx = parseFloat(f.fillPx);
        const fee = parseFloat(f.fee ?? '0');

        records.push({
          externalId: f.tradeId || f.billId,
          type: 'TRADE',
          timestamp: new Date(parseInt(f.ts, 10)),
          asset: base,
          amount: fillSz,
          quoteAsset: quote,
          quoteAmount: fillSz * fillPx,
          feeAmount: Math.abs(fee),
          feeAsset: f.feeCcy || (f.side === 'buy' ? base : quote),
          side: f.side === 'buy' ? 'BUY' : 'SELL',
          tradePair: f.instId,
          rawData: f as any,
        });
      }

      const lastBillId = fills[fills.length - 1].billId;
      if (afterBillId === lastBillId) break;
      afterBillId = lastBillId;
      cursor.spotTradesAfter = afterBillId;

      if (fills.length < 100) break;
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
      let afterTs: string | undefined = cursor.convertAfter;
      let hasMore = true;

      while (hasMore) {
        await this.delay(300);
        const params: any = { limit: '100' };
        if (afterTs) params.after = afterTs;

        const result = await this.client.getConvertHistory(params);
        const list = Array.isArray(result) ? result : (result as any)?.data ?? [];
        if (list.length === 0) break;

        for (const c of list) {
          const fromAmount = parseFloat(c.baseSz ?? c.fromAmt ?? '0');
          const toAmount = parseFloat(c.quoteSz ?? c.toAmt ?? '0');
          if (fromAmount <= 0) continue;

          const fromCcy = c.baseCcy ?? c.fromCcy ?? '';
          const toCcy = c.quoteCcy ?? c.toCcy ?? '';

          records.push({
            externalId: c.tradeId ?? c.clTReqId ?? `okx-convert-${c.ts}`,
            type: 'CONVERT',
            timestamp: new Date(parseInt(String(c.uTime ?? c.ts), 10)),
            asset: fromCcy,
            amount: fromAmount,
            quoteAsset: toCcy,
            quoteAmount: toAmount,
            rawData: c as any,
          });
        }

        const oldestTs = list[list.length - 1].ts ?? list[list.length - 1].uTime;
        if (afterTs === oldestTs) break;
        afterTs = oldestTs;
        cursor.convertAfter = afterTs;
        hasMore = list.length >= 100;
      }
    } catch (error: any) {
      this.logger.debug(`Convert history not available: ${error.message}`);
    }

    this.logger.log(`Fetched ${records.length} conversions`);
    return records;
  }

  // ---- Phase 2: Easy convert (dust) history ----
  private async fetchEasyConvertHistory(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    try {
      let afterTs: string | undefined = cursor.easyConvertAfter;
      let hasMore = true;

      while (hasMore) {
        await this.delay(300);
        const params: any = { limit: '100' };
        if (afterTs) params.after = afterTs;

        const result = await this.client.getEasyConvertHistory(params);
        const list = (result as any)?.data ?? [];
        if (!Array.isArray(list) || list.length === 0) break;

        for (const d of list) {
          const fromCcyList = d.fromData ?? [];
          const toCcyList = d.toData ?? [];

          for (const from of fromCcyList) {
            const fromAmt = parseFloat(from.amt ?? '0');
            if (fromAmt <= 0) continue;

            const to = toCcyList[0] ?? {};
            records.push({
              externalId: `okx-dust-${d.uTime}-${from.ccy}`,
              type: 'DUST_CONVERT',
              timestamp: new Date(parseInt(String(d.uTime), 10)),
              asset: from.ccy,
              amount: fromAmt,
              quoteAsset: to.ccy ?? '',
              quoteAmount: parseFloat(to.amt ?? '0'),
              rawData: d as any,
            });
          }
        }

        const oldestTs = list[list.length - 1].uTime;
        if (afterTs === oldestTs) break;
        afterTs = oldestTs;
        cursor.easyConvertAfter = afterTs;
        hasMore = list.length >= 100;
      }
    } catch (error: any) {
      this.logger.debug(`Easy convert history not available: ${error.message}`);
    }

    this.logger.log(`Fetched ${records.length} dust conversions`);
    return records;
  }

  // ---- Phase 2: Bills-based converts (type=30, subType 320/321) ----
  // OKX "Convert" operations appear as paired bills: 320 (expense) + 321 (income)
  // at the same timestamp. These do NOT appear in getConvertHistory or getFillsHistory.
  //
  // NOTE: Crypto→fiat converts (e.g. USDC→BRL) are treated as disposal/withdrawal
  // for tax purposes. The convert itself IS the taxable realization event — the
  // subsequent fiat withdrawal (PIX) is not available via OKX API and is not
  // needed since the crypto→fiat conversion already constitutes the disposal.
  // TODO: revisit if we need to track fiat withdrawals separately in the future.
  private async fetchBillConverts(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const allBills: any[] = [];

    // Fetch recent bills (last 7 days)
    try {
      let afterId: string | undefined = cursor.billConvertRecentAfter;
      let hasMore = true;
      while (hasMore) {
        await this.delay(300);
        const params: any = { limit: '100' };
        if (afterId) params.after = afterId;

        const bills = await (this.client as any).getBills(params);
        const list = Array.isArray(bills) ? bills : [];
        if (list.length === 0) break;

        allBills.push(...list);
        const lastId = list[list.length - 1].billId;
        if (afterId === lastId) break;
        afterId = lastId;
        cursor.billConvertRecentAfter = afterId;
        hasMore = list.length >= 100;
      }
    } catch (error: any) {
      this.logger.debug(`Recent bills not available: ${error.message}`);
    }

    // Fetch archived bills (last 3 months)
    try {
      let afterId: string | undefined = cursor.billConvertArchiveAfter;
      let hasMore = true;
      const existingIds = new Set(allBills.map(b => b.billId));

      while (hasMore) {
        await this.delay(300);
        const params: any = { limit: '100' };
        if (afterId) params.after = afterId;

        const bills = await this.client.getBillsArchive(params);
        const list = Array.isArray(bills) ? bills : [];
        if (list.length === 0) break;

        for (const b of list) {
          if (!existingIds.has((b as any).billId)) {
            allBills.push(b);
            existingIds.add((b as any).billId);
          }
        }

        const lastId = (list[list.length - 1] as any).billId;
        if (afterId === lastId) break;
        afterId = lastId;
        cursor.billConvertArchiveAfter = afterId;
        hasMore = list.length >= 100;
      }
    } catch (error: any) {
      this.logger.debug(`Bills archive not available: ${error.message}`);
    }

    // Filter convert bills (type=30)
    const convertBills = allBills.filter(b => b.type === '30');
    if (convertBills.length === 0) {
      this.logger.log('Fetched 0 bill-based conversions');
      return [];
    }

    // Group by timestamp to pair expense (320) + income (321)
    const byTimestamp = new Map<string, any[]>();
    for (const b of convertBills) {
      const ts = b.ts;
      if (!byTimestamp.has(ts)) byTimestamp.set(ts, []);
      byTimestamp.get(ts)!.push(b);
    }

    const records: ExchangeRecord[] = [];

    for (const [ts, bills] of byTimestamp) {
      const expense = bills.find(b => b.subType === '320'); // from-asset (gets BRL/fiat)
      const income = bills.find(b => b.subType === '321');  // to-asset (spends crypto)

      if (!expense || !income) {
        // Unpaired bill — log and skip
        this.logger.debug(`Unpaired convert bill at ts=${ts}`);
        continue;
      }

      // expense.ccy = what you RECEIVE (e.g. BRL), expense.sz = amount received
      // income.ccy = what you SPEND (e.g. USDC), income.sz = amount spent
      // instId on expense has the pair (e.g. "USDC-BRL")
      const fromAsset = income.ccy;    // crypto sold
      const fromAmount = Math.abs(parseFloat(income.sz));
      const toAsset = expense.ccy;      // fiat/crypto received
      const toAmount = Math.abs(parseFloat(expense.sz));
      const instId = expense.instId || income.instId || `${fromAsset}-${toAsset}`;

      // Derive price: how much toAsset per 1 fromAsset
      const priceUsd = fromAmount > 0 ? toAmount / fromAmount : undefined;

      records.push({
        externalId: `okx-convert-${expense.billId}`,
        type: 'CONVERT',
        timestamp: new Date(parseInt(ts, 10)),
        asset: fromAsset,
        amount: fromAmount,
        quoteAsset: toAsset,
        quoteAmount: toAmount,
        tradePair: instId,
        rawData: { expense, income },
      });
    }

    this.logger.log(`Fetched ${records.length} bill-based conversions`);
    return records;
  }

  // ---- Phase 3: Staking order history ----
  private async fetchStakingOrderHistory(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    try {
      let afterOrdId: string | undefined = cursor.stakingAfter;
      let hasMore = true;

      while (hasMore) {
        await this.delay(300);
        const params: any = { limit: '100' };
        if (afterOrdId) params.after = afterOrdId;

        const result = await this.client.getStakingOrderHistory(params);
        const list = Array.isArray(result) ? result : [];
        if (list.length === 0) break;

        for (const s of list) {
          const ccy = s.ccy ?? '';
          const investAmt = parseFloat(s.investData?.[0]?.amt ?? s.amt ?? '0');
          if (investAmt <= 0) continue;

          // purchaseType: subscribe → STAKE, redeem → UNSTAKE
          const action = String(s.state ?? s.action ?? '').toLowerCase();
          const type: ExchangeRecord['type'] = action.includes('redeem') ? 'UNSTAKE' : 'STAKE';

          records.push({
            externalId: s.ordId ?? `okx-staking-${s.ts}-${ccy}`,
            type,
            timestamp: new Date(parseInt(String(s.ts ?? s.purchaseTime), 10)),
            asset: ccy,
            amount: investAmt,
            rawData: s as any,
          });
        }

        const lastId = list[list.length - 1].ordId ?? list[list.length - 1].ts;
        if (afterOrdId === lastId) break;
        afterOrdId = lastId;
        cursor.stakingAfter = afterOrdId;
        hasMore = list.length >= 100;
      }
    } catch (error: any) {
      this.logger.debug(`Staking order history not available: ${error.message}`);
    }

    this.logger.log(`Fetched ${records.length} staking orders`);
    return records;
  }

  // ---- Phase 3: Lending/savings history ----
  private async fetchLendingHistory(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    try {
      let afterTs: string | undefined = cursor.lendingAfter;
      let hasMore = true;

      while (hasMore) {
        await this.delay(300);
        const params: any = { limit: '100' };
        if (afterTs) params.after = afterTs;

        const result = await this.client.getLendingHistory(params);
        const list = Array.isArray(result) ? result : [];
        if (list.length === 0) break;

        for (const l of list) {
          const ccy = l.ccy ?? '';
          const amount = parseFloat(l.amt ?? '0');
          if (amount <= 0) continue;

          records.push({
            externalId: `okx-lending-${l.ts}-${ccy}`,
            type: 'INTEREST',
            timestamp: new Date(parseInt(String(l.ts), 10)),
            asset: ccy,
            amount,
            rawData: l as any,
          });
        }

        const oldestTs = list[list.length - 1].ts;
        if (afterTs === oldestTs) break;
        afterTs = oldestTs;
        cursor.lendingAfter = afterTs;
        hasMore = list.length >= 100;
      }
    } catch (error: any) {
      this.logger.debug(`Lending history not available: ${error.message}`);
    }

    this.logger.log(`Fetched ${records.length} lending records`);
    return records;
  }

  // ---- Phase 3: ETH staking history ----
  private async fetchETHStakingHistory(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    try {
      for (const stakingType of ['purchase', 'redeem'] as const) {
        let afterTs: string | undefined = cursor[`ethStaking_${stakingType}_after`];
        let hasMore = true;

        while (hasMore) {
          await this.delay(300);
          const params: any = { type: stakingType, limit: '100' };
          if (afterTs) params.after = afterTs;

          const result = await this.client.getETHStakingHistory(params);
          const list = Array.isArray(result) ? result : [];
          if (list.length === 0) break;

          for (const e of list) {
            const amount = parseFloat(e.amt ?? '0');
            if (amount <= 0) continue;

            records.push({
              externalId: e.ordId ?? `okx-eth-staking-${e.ts}-${stakingType}`,
              type: stakingType === 'purchase' ? 'STAKE' : 'UNSTAKE',
              timestamp: new Date(parseInt(String(e.ts), 10)),
              asset: 'ETH',
              amount,
              rawData: e as any,
            });
          }

          const oldestTs = list[list.length - 1].ts;
          if (afterTs === oldestTs) break;
          afterTs = oldestTs;
          cursor[`ethStaking_${stakingType}_after`] = afterTs;
          hasMore = list.length >= 100;
        }
      }
    } catch (error: any) {
      this.logger.debug(`ETH staking history not available: ${error.message}`);
    }

    this.logger.log(`Fetched ${records.length} ETH staking records`);
    return records;
  }

  // ---- Phase 4: Margin trades ----
  private async fetchMarginTrades(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    return this.fetchFillsByInstType('MARGIN', cursor, 'marginTradesAfter');
  }

  // ---- Phase 4: Swap (perpetual) trades ----
  private async fetchSwapTrades(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    return this.fetchFillsByInstType('SWAP', cursor, 'swapTradesAfter');
  }

  private async fetchFillsByInstType(
    instType: string,
    cursor: Record<string, any>,
    cursorKey: string,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];
    let afterBillId: string | undefined = cursor[cursorKey];

    while (true) {
      await this.delay(250);
      const params: any = { instType, limit: '100' };
      if (afterBillId) params.after = afterBillId;

      const fills = await this.client.getFillsHistory(params);
      if (!fills || fills.length === 0) break;

      for (const f of fills) {
        const { base, quote } = this.parseSymbol(f.instId);
        const fillSz = parseFloat(f.fillSz);
        const fillPx = parseFloat(f.fillPx);
        const fee = parseFloat(f.fee ?? '0');

        records.push({
          externalId: f.tradeId || f.billId,
          type: 'TRADE',
          timestamp: new Date(parseInt(f.ts, 10)),
          asset: base,
          amount: fillSz,
          quoteAsset: quote,
          quoteAmount: fillSz * fillPx,
          feeAmount: Math.abs(fee),
          feeAsset: f.feeCcy || quote,
          side: f.side === 'buy' ? 'BUY' : 'SELL',
          tradePair: f.instId,
          rawData: f as any,
        });
      }

      const lastBillId = fills[fills.length - 1].billId;
      if (afterBillId === lastBillId) break;
      afterBillId = lastBillId;
      cursor[cursorKey] = afterBillId;

      if (fills.length < 100) break;
    }

    this.logger.log(`Fetched ${records.length} ${instType} trades`);
    return records;
  }

  // ---- Phase 4: Bills archive (funding fees, liquidations, etc.) ----
  private async fetchBillsArchive(
    options: SyncOptions,
    cursor: Record<string, any>,
  ): Promise<ExchangeRecord[]> {
    const records: ExchangeRecord[] = [];

    try {
      let afterBillId: string | undefined = cursor.billsArchiveAfter;
      let hasMore = true;

      while (hasMore) {
        await this.delay(300);
        const params: any = { limit: '100' };
        if (afterBillId) params.after = afterBillId;

        const bills = await this.client.getBillsArchive(params);
        if (!bills || bills.length === 0) break;

        for (const b of bills) {
          // Skip converts (type=30) and transfers (type=1) — handled by Phase 2
          const billType = String((b as any).type ?? '');
          if (billType === '30' || billType === '1') continue;

          const balChg = parseFloat((b as any).balChg ?? (b as any).pnl ?? '0');
          if (balChg === 0) continue;

          const subType = String((b as any).subType ?? (b as any).type ?? '');
          const type = this.mapBillSubType(subType);
          if (!type) continue;

          const ccy = (b as any).ccy ?? '';
          records.push({
            externalId: (b as any).billId ?? `okx-bill-${(b as any).ts}`,
            type,
            timestamp: new Date(parseInt(String((b as any).ts), 10)),
            asset: ccy,
            amount: Math.abs(balChg),
            rawData: b as any,
          });
        }

        const lastBillId = (bills[bills.length - 1] as any).billId;
        if (afterBillId === lastBillId) break;
        afterBillId = lastBillId;
        cursor.billsArchiveAfter = afterBillId;
        hasMore = bills.length >= 100;
      }
    } catch (error: any) {
      this.logger.debug(`Bills archive not available: ${error.message}`);
    }

    this.logger.log(`Fetched ${records.length} bill records`);
    return records;
  }

  // ===== Real-time balances =====

  async fetchRealTimeBalances(): Promise<{ asset: string; free: number; locked: number; source: string }[]> {
    const balances: { asset: string; free: number; locked: number; source: string }[] = [];

    // Trading Account (unified)
    try {
      const accounts = await this.client.getBalance();
      if (accounts && accounts.length > 0) {
        const details = accounts[0].details ?? [];
        for (const d of details) {
          const free = parseFloat(d.availBal ?? '0');
          const frozen = parseFloat(d.frozenBal ?? '0');
          const eq = parseFloat(d.eq ?? '0');
          if (eq > 0 || free > 0 || frozen > 0) {
            balances.push({
              asset: d.ccy,
              free,
              locked: frozen,
              source: 'trading',
            });
          }
        }
      }
    } catch (error: any) {
      this.logger.debug(`Trading balance not available: ${error.message}`);
    }

    // Funding Account
    try {
      const fundBalances = await this.client.getBalances();
      for (const f of fundBalances) {
        const free = parseFloat(f.availBal ?? '0');
        const frozen = parseFloat(f.frozenBal ?? '0');
        if (free > 0 || frozen > 0) {
          balances.push({
            asset: f.ccy,
            free,
            locked: frozen,
            source: 'funding',
          });
        }
      }
    } catch (error: any) {
      this.logger.debug(`Funding balance not available: ${error.message}`);
    }

    // Savings (Simple Earn Flexible)
    try {
      const savings = await this.client.getSavingBalance();
      const savingsList = Array.isArray(savings) ? savings : [];
      for (const s of savingsList) {
        const amount = parseFloat((s as any).amt ?? '0');
        if (amount > 0) {
          balances.push({
            asset: (s as any).ccy,
            free: 0,
            locked: amount,
            source: 'savings',
          });
        }
      }
    } catch (error: any) {
      this.logger.debug(`Savings balance not available: ${error.message}`);
    }

    // Staking (active orders)
    try {
      const stakingOrders = await this.client.getActiveStakingOrders();
      const stakingList = Array.isArray(stakingOrders) ? stakingOrders : [];
      for (const o of stakingList) {
        const ccy = (o as any).ccy ?? (o as any).investData?.[0]?.ccy ?? '';
        const amount = parseFloat((o as any).investData?.[0]?.amt ?? (o as any).amt ?? '0');
        if (amount > 0 && ccy) {
          balances.push({
            asset: ccy,
            free: 0,
            locked: amount,
            source: 'staking',
          });
        }
      }
    } catch (error: any) {
      this.logger.debug(`Staking positions not available: ${error.message}`);
    }

    return balances;
  }

  // ===== Deposit address discovery =====

  async fetchDepositAddresses(): Promise<{ coin: string; network: string; address: string; tag?: string }[]> {
    const addresses: { coin: string; network: string; address: string; tag?: string }[] = [];

    try {
      // Get currencies with balance
      const fundBalances = await this.client.getBalances();
      const coins = fundBalances
        .filter(f => parseFloat(f.availBal ?? '0') > 0 || parseFloat(f.frozenBal ?? '0') > 0)
        .map(f => f.ccy);

      const commonCoins = [...new Set([...coins, 'BTC', 'ETH', 'USDT', 'USDC', 'SOL'])];

      for (const coin of commonCoins) {
        try {
          await this.delay(200);
          const result = await this.client.getDepositAddress({ ccy: coin });
          const addrList = Array.isArray(result) ? result : [];

          for (const a of addrList) {
            const addr = (a as any).addr ?? '';
            if (!addr) continue;

            addresses.push({
              coin,
              network: (a as any).chain ?? '',
              address: addr,
              tag: (a as any).tag || (a as any).memo || undefined,
            });
          }
        } catch {
          // Some coins may not support deposit address
        }
      }
    } catch (error: any) {
      this.logger.warn(`Failed to fetch deposit addresses: ${error.message}`);
    }

    this.logger.log(`Fetched ${addresses.length} deposit addresses`);
    return addresses;
  }

  // ======== UTILITIES ========

  private parseSymbol(instId: string): { base: string; quote: string } {
    // OKX uses hyphenated format: "BTC-USDT", "ETH-BTC"
    const parts = instId.split('-');
    return { base: parts[0] ?? '', quote: parts[1] ?? '' };
  }

  private mapBillSubType(subType: string): ExchangeRecord['type'] | null {
    const st = subType.toLowerCase();
    // Funding fee (perpetual swap funding)
    if (st.includes('funding') || st === '8') return 'MARGIN_INTEREST';
    // Interest (borrow interest)
    if (st.includes('interest') || st === '7') return 'MARGIN_INTEREST';
    // Liquidation
    if (st.includes('liquidation') || st === '14') return 'MARGIN_LIQUIDATION';
    // Airdrop / distribution
    if (st.includes('airdrop') || st.includes('distribution')) return 'DIVIDEND';
    // Fee rebate / cashback
    if (st.includes('rebate') || st.includes('cashback')) return 'DIVIDEND';
    // Transfer — skip (internal movements)
    if (st.includes('transfer') || st === '12') return null;
    // Trading fee — skip (already captured in fills)
    if (st === '1' || st === '2') return null;
    return null;
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
