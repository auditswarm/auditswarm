import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TokenSymbolMappingRepository } from '@auditswarm/database';
import { ExchangeRecord, ExchangeRecordType } from '../../../api/src/exchange-imports/adapters/base-adapter';

const STABLECOINS = new Set([
  'USDT', 'USDC', 'BUSD', 'FDUSD', 'USD1', 'DAI', 'TUSD', 'USDP', 'GUSD', 'FRAX',
  'PYUSD', 'USDD', 'CUSD', 'SUSD', 'LUSD', 'EURC', 'AEUR',
]);

const FIAT_CURRENCIES = new Set([
  'USD', 'BRL', 'EUR', 'GBP', 'AUD', 'CAD', 'JPY', 'TRY', 'RUB', 'NGN',
  'ARS', 'COP', 'KES', 'ZAR', 'INR', 'IDR', 'PHP', 'VND', 'THB', 'MYR',
]);

function isStablecoin(symbol: string): boolean {
  return STABLECOINS.has(symbol.toUpperCase());
}

function isFiat(symbol: string): boolean {
  return FIAT_CURRENCIES.has(symbol.toUpperCase());
}

function isUsdLike(symbol: string): boolean {
  return isStablecoin(symbol) || symbol.toUpperCase() === 'USD';
}

export interface MappedTransaction {
  id?: string;
  walletId: null;
  signature: null;
  type: string;
  status: string;
  timestamp: Date;
  slot: null;
  blockTime: null;
  fee: null;
  feePayer: null;
  source: 'EXCHANGE';
  exchangeConnectionId: string;
  exchangeName: string;
  externalId: string;
  category: string | null;
  totalValueUsd: Prisma.Decimal | null;
  transfers: any[];
  rawData: any;
}

export interface MappedFlow {
  transactionId?: string;
  walletId: null;
  mint: string;
  decimals: number;
  rawAmount: string;
  amount: Prisma.Decimal;
  direction: 'IN' | 'OUT';
  valueUsd: Prisma.Decimal | null;
  exchangeConnectionId: string;
  symbol: string;
  network: string | null;
  isFee: boolean;
  priceAtExecution: Prisma.Decimal | null;
}

export interface MappingResult {
  transaction: MappedTransaction;
  flows: MappedFlow[];
}

const TYPE_MAP: Record<ExchangeRecordType, string> = {
  TRADE: 'EXCHANGE_TRADE',
  DEPOSIT: 'EXCHANGE_DEPOSIT',
  WITHDRAWAL: 'EXCHANGE_WITHDRAWAL',
  FEE: 'FEE',
  FIAT_BUY: 'EXCHANGE_FIAT_BUY',
  FIAT_SELL: 'EXCHANGE_FIAT_SELL',
  CONVERT: 'EXCHANGE_CONVERT',
  DUST_CONVERT: 'EXCHANGE_DUST_CONVERT',
  C2C_TRADE: 'EXCHANGE_C2C_TRADE',
  STAKE: 'EXCHANGE_STAKE',
  UNSTAKE: 'EXCHANGE_UNSTAKE',
  INTEREST: 'EXCHANGE_INTEREST',
  DIVIDEND: 'EXCHANGE_DIVIDEND',
  MARGIN_BORROW: 'MARGIN_BORROW',
  MARGIN_REPAY: 'MARGIN_REPAY',
  MARGIN_INTEREST: 'MARGIN_INTEREST',
  MARGIN_LIQUIDATION: 'MARGIN_LIQUIDATION',
  MINING: 'EXCHANGE_INTEREST',
};

@Injectable()
export class ExchangeTransactionMapperService {
  private readonly logger = new Logger(ExchangeTransactionMapperService.name);

  constructor(
    private readonly tokenSymbolMapping: TokenSymbolMappingRepository,
  ) {}

  async mapRecord(
    record: ExchangeRecord,
    connectionId: string,
    exchangeName: string,
  ): Promise<MappingResult> {
    const txType = TYPE_MAP[record.type] ?? 'UNKNOWN';
    const flows: MappedFlow[] = [];

    switch (record.type) {
      case 'TRADE':
      case 'C2C_TRADE':
        await this.mapTrade(record, connectionId, flows);
        break;

      case 'DEPOSIT':
        await this.mapDeposit(record, connectionId, flows);
        break;

      case 'WITHDRAWAL':
        await this.mapWithdrawal(record, connectionId, flows);
        break;

      case 'FIAT_BUY':
        await this.mapFiatBuy(record, connectionId, flows);
        break;

      case 'FIAT_SELL':
        await this.mapFiatSell(record, connectionId, flows);
        break;

      case 'CONVERT':
      case 'DUST_CONVERT':
        await this.mapConvert(record, connectionId, flows);
        break;

      case 'STAKE':
        await this.mapStake(record, connectionId, flows);
        break;

      case 'UNSTAKE':
        await this.mapUnstake(record, connectionId, flows);
        break;

      case 'INTEREST':
      case 'DIVIDEND':
      case 'MINING':
        await this.mapIncome(record, connectionId, flows);
        break;

      case 'MARGIN_BORROW':
        await this.mapMarginBorrow(record, connectionId, flows);
        break;

      case 'MARGIN_REPAY':
        await this.mapMarginRepay(record, connectionId, flows);
        break;

      case 'MARGIN_INTEREST':
        await this.mapMarginInterest(record, connectionId, flows);
        break;

      case 'MARGIN_LIQUIDATION':
        await this.mapMarginLiquidation(record, connectionId, flows);
        break;

      default:
        await this.mapGeneric(record, connectionId, flows);
        break;
    }

    // Compute total value from flows
    let totalValueUsd: Prisma.Decimal | null = null;
    const nonFeeFlows = flows.filter(f => !f.isFee);
    const withValue = nonFeeFlows.filter(f => f.valueUsd !== null);
    if (withValue.length > 0) {
      totalValueUsd = withValue.reduce(
        (sum, f) => sum.add(f.valueUsd!),
        new Prisma.Decimal(0),
      );
    } else if (record.totalValueUsd != null) {
      totalValueUsd = new Prisma.Decimal(record.totalValueUsd);
    }

    // If still no value, try extracting from raw data
    if (totalValueUsd === null || totalValueUsd.eq(0)) {
      const extractedUsd = this.extractUsdFromRawData(record);
      if (extractedUsd !== null && extractedUsd > 0) {
        totalValueUsd = new Prisma.Decimal(extractedUsd.toFixed(8));
      }
    }

    // Build transfers JSON from flows (for bee compatibility)
    const transfers = flows.map(f => ({
      mint: f.mint,
      symbol: f.symbol,
      amount: Number(f.amount),
      direction: f.direction,
      from: f.direction === 'OUT' ? `exchange:${exchangeName}` : 'external',
      to: f.direction === 'IN' ? `exchange:${exchangeName}` : 'external',
      valueUsd: f.valueUsd ? Number(f.valueUsd) : undefined,
      isFee: f.isFee,
      priceAtExecution: f.priceAtExecution ? Number(f.priceAtExecution) : undefined,
    }));

    const transaction: MappedTransaction = {
      walletId: null,
      signature: null,
      type: txType,
      status: 'CONFIRMED',
      timestamp: record.timestamp,
      slot: null,
      blockTime: null,
      fee: null,
      feePayer: null,
      source: 'EXCHANGE',
      exchangeConnectionId: connectionId,
      exchangeName,
      externalId: record.externalId ?? `${exchangeName}-${record.type}-${record.timestamp.getTime()}`,
      category: this.inferCategory(txType),
      totalValueUsd,
      transfers,
      rawData: record.rawData ?? null,
    };

    return { transaction, flows };
  }

  async mapBatch(
    records: ExchangeRecord[],
    connectionId: string,
    exchangeName: string,
  ): Promise<MappingResult[]> {
    const results: MappingResult[] = [];
    for (const record of records) {
      try {
        results.push(await this.mapRecord(record, connectionId, exchangeName));
      } catch (error: any) {
        this.logger.warn(
          `Failed to map record ${record.externalId}: ${error.message}`,
        );
      }
    }
    return results;
  }

  // ---- Trade: OUT quote, IN base (BUY) or OUT base, IN quote (SELL) + fee ----

  private async mapTrade(
    record: ExchangeRecord,
    connectionId: string,
    flows: MappedFlow[],
  ): Promise<void> {
    const isBuy = record.side === 'BUY';
    const baseSymbol = record.asset;
    const quoteSymbol = record.quoteAsset ?? this.extractQuoteFromPair(record.tradePair, baseSymbol);

    const baseResolved = await this.resolveToken(baseSymbol, record.network);
    const quoteResolved = quoteSymbol
      ? await this.resolveToken(quoteSymbol, record.network)
      : null;

    const baseAmount = Math.abs(record.amount);
    const quoteAmount = record.quoteAmount ?? (record.totalValueUsd ?? 0);

    if (isBuy) {
      // IN base asset
      flows.push(this.createFlow(
        connectionId, baseResolved.mint, baseResolved.decimals, baseSymbol,
        baseAmount, 'IN', record.priceUsd, record.network, false,
      ));
      // OUT quote asset
      if (quoteResolved && quoteAmount > 0) {
        flows.push(this.createFlow(
          connectionId, quoteResolved.mint, quoteResolved.decimals, quoteSymbol!,
          quoteAmount, 'OUT', null, record.network, false,
        ));
      }
    } else {
      // OUT base asset
      flows.push(this.createFlow(
        connectionId, baseResolved.mint, baseResolved.decimals, baseSymbol,
        baseAmount, 'OUT', record.priceUsd, record.network, false,
      ));
      // IN quote asset
      if (quoteResolved && quoteAmount > 0) {
        flows.push(this.createFlow(
          connectionId, quoteResolved.mint, quoteResolved.decimals, quoteSymbol!,
          quoteAmount, 'IN', null, record.network, false,
        ));
      }
    }

    // Fee flow
    if (record.feeAmount && record.feeAmount > 0 && record.feeAsset) {
      const feeResolved = await this.resolveToken(record.feeAsset, record.network);
      flows.push(this.createFlow(
        connectionId, feeResolved.mint, feeResolved.decimals, record.feeAsset,
        record.feeAmount, 'OUT', null, record.network, true,
      ));
    }
  }

  // ---- Deposit: IN asset ----

  private async mapDeposit(
    record: ExchangeRecord,
    connectionId: string,
    flows: MappedFlow[],
  ): Promise<void> {
    const resolved = await this.resolveToken(record.asset, record.network);
    flows.push(this.createFlow(
      connectionId, resolved.mint, resolved.decimals, record.asset,
      Math.abs(record.amount), 'IN', record.priceUsd, record.network, false,
    ));
  }

  // ---- Withdrawal: OUT asset ----

  private async mapWithdrawal(
    record: ExchangeRecord,
    connectionId: string,
    flows: MappedFlow[],
  ): Promise<void> {
    const resolved = await this.resolveToken(record.asset, record.network);
    flows.push(this.createFlow(
      connectionId, resolved.mint, resolved.decimals, record.asset,
      Math.abs(record.amount), 'OUT', record.priceUsd, record.network, false,
    ));

    if (record.feeAmount && record.feeAmount > 0) {
      const feeAsset = record.feeAsset ?? record.asset;
      const feeResolved = await this.resolveToken(feeAsset, record.network);
      flows.push(this.createFlow(
        connectionId, feeResolved.mint, feeResolved.decimals, feeAsset,
        record.feeAmount, 'OUT', null, record.network, true,
      ));
    }
  }

  // ---- Fiat Buy: IN crypto ----

  private async mapFiatBuy(
    record: ExchangeRecord,
    connectionId: string,
    flows: MappedFlow[],
  ): Promise<void> {
    const resolved = await this.resolveToken(record.asset, record.network);
    flows.push(this.createFlow(
      connectionId, resolved.mint, resolved.decimals, record.asset,
      Math.abs(record.amount), 'IN', record.priceUsd, record.network, false,
    ));

    if (record.feeAmount && record.feeAmount > 0 && record.feeAsset) {
      const feeResolved = await this.resolveToken(record.feeAsset, record.network);
      flows.push(this.createFlow(
        connectionId, feeResolved.mint, feeResolved.decimals, record.feeAsset,
        record.feeAmount, 'OUT', null, record.network, true,
      ));
    }
  }

  // ---- Fiat Sell: OUT crypto, IN fiat ----

  private async mapFiatSell(
    record: ExchangeRecord,
    connectionId: string,
    flows: MappedFlow[],
  ): Promise<void> {
    const resolved = await this.resolveToken(record.asset, record.network);
    flows.push(this.createFlow(
      connectionId, resolved.mint, resolved.decimals, record.asset,
      Math.abs(record.amount), 'OUT', record.priceUsd, record.network, false,
    ));

    if (record.feeAmount && record.feeAmount > 0 && record.feeAsset) {
      const feeResolved = await this.resolveToken(record.feeAsset, record.network);
      flows.push(this.createFlow(
        connectionId, feeResolved.mint, feeResolved.decimals, record.feeAsset,
        record.feeAmount, 'OUT', null, record.network, true,
      ));
    }

    // IN flow for the fiat received
    if (record.quoteAsset && record.quoteAmount) {
      const fiatResolved = await this.resolveToken(record.quoteAsset, record.network);
      flows.push(this.createFlow(
        connectionId, fiatResolved.mint, fiatResolved.decimals, record.quoteAsset,
        Math.abs(record.quoteAmount), 'IN', null, record.network, false,
      ));
    }
  }

  // ---- Convert / Dust Convert: OUT source, IN target ----

  private async mapConvert(
    record: ExchangeRecord,
    connectionId: string,
    flows: MappedFlow[],
  ): Promise<void> {
    const sourceResolved = await this.resolveToken(record.asset, record.network);
    const raw = record.rawData as any;

    // Derive prices from convert ratio when one side is USD-like
    let sourcePriceUsd = record.priceUsd ?? null;
    let targetPriceUsd: number | null = null;

    if (record.quoteAsset && record.quoteAmount && record.amount > 0) {
      if (isUsdLike(record.quoteAsset)) {
        // target is stablecoin: source price = targetAmount / sourceAmount
        sourcePriceUsd = sourcePriceUsd ?? (Math.abs(record.quoteAmount) / Math.abs(record.amount));
        targetPriceUsd = 1.0;
      } else if (isUsdLike(record.asset)) {
        // source is stablecoin: target price = sourceAmount / targetAmount
        sourcePriceUsd = sourcePriceUsd ?? 1.0;
        targetPriceUsd = record.quoteAmount > 0 ? (Math.abs(record.amount) / Math.abs(record.quoteAmount)) : null;
      }
    }

    // Fallback: use fillIdxPx from OKX raw bill data (USD index price of the asset)
    // This handles crypto→fiat converts (e.g. ETH→BRL) where neither side is USD-like
    if (sourcePriceUsd == null) {
      const idxPx = parseFloat(raw?.expense?.fillIdxPx || raw?.income?.fillIdxPx || '0');
      if (idxPx > 0) {
        sourcePriceUsd = idxPx;
      }
    }

    flows.push(this.createFlow(
      connectionId, sourceResolved.mint, sourceResolved.decimals, record.asset,
      Math.abs(record.amount), 'OUT', sourcePriceUsd, record.network, false,
    ));

    if (record.quoteAsset && record.quoteAmount) {
      const targetResolved = await this.resolveToken(record.quoteAsset, record.network);
      flows.push(this.createFlow(
        connectionId, targetResolved.mint, targetResolved.decimals, record.quoteAsset,
        Math.abs(record.quoteAmount), 'IN', targetPriceUsd, record.network, false,
      ));
    }
  }

  // ---- Stake: OUT asset, IN staked variant ----

  private async mapStake(
    record: ExchangeRecord,
    connectionId: string,
    flows: MappedFlow[],
  ): Promise<void> {
    const resolved = await this.resolveToken(record.asset, record.network);
    flows.push(this.createFlow(
      connectionId, resolved.mint, resolved.decimals, record.asset,
      Math.abs(record.amount), 'OUT', record.priceUsd, record.network, false,
    ));

    // If there's a staked token (e.g., BETH for ETH)
    if (record.quoteAsset && record.quoteAmount) {
      const stakedResolved = await this.resolveToken(record.quoteAsset, record.network);
      flows.push(this.createFlow(
        connectionId, stakedResolved.mint, stakedResolved.decimals, record.quoteAsset,
        Math.abs(record.quoteAmount), 'IN', null, record.network, false,
      ));
    }
  }

  // ---- Unstake: OUT staked, IN original ----

  private async mapUnstake(
    record: ExchangeRecord,
    connectionId: string,
    flows: MappedFlow[],
  ): Promise<void> {
    const resolved = await this.resolveToken(record.asset, record.network);
    flows.push(this.createFlow(
      connectionId, resolved.mint, resolved.decimals, record.asset,
      Math.abs(record.amount), 'IN', record.priceUsd, record.network, false,
    ));

    if (record.quoteAsset && record.quoteAmount) {
      const stakedResolved = await this.resolveToken(record.quoteAsset, record.network);
      flows.push(this.createFlow(
        connectionId, stakedResolved.mint, stakedResolved.decimals, record.quoteAsset,
        Math.abs(record.quoteAmount), 'OUT', null, record.network, false,
      ));
    }
  }

  // ---- Income (Interest/Dividend/Mining): IN reward token ----

  private async mapIncome(
    record: ExchangeRecord,
    connectionId: string,
    flows: MappedFlow[],
  ): Promise<void> {
    const resolved = await this.resolveToken(record.asset, record.network);
    flows.push(this.createFlow(
      connectionId, resolved.mint, resolved.decimals, record.asset,
      Math.abs(record.amount), 'IN', record.priceUsd, record.network, false,
    ));
  }

  // ---- Margin Borrow: IN borrowed token ----

  private async mapMarginBorrow(
    record: ExchangeRecord,
    connectionId: string,
    flows: MappedFlow[],
  ): Promise<void> {
    const resolved = await this.resolveToken(record.asset, record.network);
    flows.push(this.createFlow(
      connectionId, resolved.mint, resolved.decimals, record.asset,
      Math.abs(record.amount), 'IN', record.priceUsd, record.network, false,
    ));
  }

  // ---- Margin Repay: OUT repaid token ----

  private async mapMarginRepay(
    record: ExchangeRecord,
    connectionId: string,
    flows: MappedFlow[],
  ): Promise<void> {
    const resolved = await this.resolveToken(record.asset, record.network);
    flows.push(this.createFlow(
      connectionId, resolved.mint, resolved.decimals, record.asset,
      Math.abs(record.amount), 'OUT', record.priceUsd, record.network, false,
    ));
  }

  // ---- Margin Interest: OUT interest token ----

  private async mapMarginInterest(
    record: ExchangeRecord,
    connectionId: string,
    flows: MappedFlow[],
  ): Promise<void> {
    const resolved = await this.resolveToken(record.asset, record.network);
    flows.push(this.createFlow(
      connectionId, resolved.mint, resolved.decimals, record.asset,
      Math.abs(record.amount), 'OUT', record.priceUsd, record.network, false,
    ));
  }

  // ---- Margin Liquidation: OUT collateral, IN remaining ----

  private async mapMarginLiquidation(
    record: ExchangeRecord,
    connectionId: string,
    flows: MappedFlow[],
  ): Promise<void> {
    const resolved = await this.resolveToken(record.asset, record.network);
    flows.push(this.createFlow(
      connectionId, resolved.mint, resolved.decimals, record.asset,
      Math.abs(record.amount), 'OUT', record.priceUsd, record.network, false,
    ));

    if (record.quoteAsset && record.quoteAmount && record.quoteAmount > 0) {
      const remainResolved = await this.resolveToken(record.quoteAsset, record.network);
      flows.push(this.createFlow(
        connectionId, remainResolved.mint, remainResolved.decimals, record.quoteAsset,
        Math.abs(record.quoteAmount), 'IN', null, record.network, false,
      ));
    }
  }

  // ---- Generic fallback ----

  private async mapGeneric(
    record: ExchangeRecord,
    connectionId: string,
    flows: MappedFlow[],
  ): Promise<void> {
    const resolved = await this.resolveToken(record.asset, record.network);
    const direction = record.side === 'SELL' ? 'OUT' : 'IN';
    flows.push(this.createFlow(
      connectionId, resolved.mint, resolved.decimals, record.asset,
      Math.abs(record.amount), direction, record.priceUsd, record.network, false,
    ));
  }

  // ---- Helpers ----

  private createFlow(
    connectionId: string,
    mint: string,
    decimals: number,
    symbol: string,
    amount: number,
    direction: 'IN' | 'OUT',
    priceUsd: number | null | undefined,
    network: string | null | undefined,
    isFee: boolean,
  ): MappedFlow {
    const rawAmount = this.toRawAmount(amount, decimals);
    const decimalAmount = new Prisma.Decimal(amount.toFixed(Math.min(decimals, 18)));

    // Auto-detect stablecoin price if not provided
    let resolvedPrice = priceUsd;
    if ((resolvedPrice == null || resolvedPrice === 0) && isUsdLike(symbol)) {
      resolvedPrice = 1.0;
    }

    const valueUsd = resolvedPrice != null && resolvedPrice > 0
      ? new Prisma.Decimal((amount * resolvedPrice).toFixed(8))
      : null;

    return {
      walletId: null,
      mint,
      decimals,
      rawAmount,
      amount: decimalAmount,
      direction,
      valueUsd,
      exchangeConnectionId: connectionId,
      symbol: symbol.toUpperCase(),
      network: network ?? null,
      isFee,
      priceAtExecution: resolvedPrice != null && resolvedPrice > 0
        ? new Prisma.Decimal(resolvedPrice.toFixed(8))
        : null,
    };
  }

  private async resolveToken(
    symbol: string,
    network?: string | null,
  ): Promise<{ mint: string; decimals: number }> {
    return this.tokenSymbolMapping.resolveToMint(symbol, network ?? undefined);
  }

  private toRawAmount(amount: number, decimals: number): string {
    return Math.round(amount * Math.pow(10, decimals)).toString();
  }

  private extractQuoteFromPair(
    tradePair: string | undefined,
    baseAsset: string,
  ): string | undefined {
    if (!tradePair) return undefined;

    // Handle "BASE/QUOTE" format
    if (tradePair.includes('/')) {
      const parts = tradePair.split('/');
      return parts[1];
    }

    // Handle "BASEUSDT" format
    const knownQuotes = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'BTC', 'ETH', 'BNB', 'BRL', 'EUR', 'USD', 'TRY'];
    for (const q of knownQuotes) {
      if (tradePair.endsWith(q) && tradePair.startsWith(baseAsset)) {
        return q;
      }
    }

    return undefined;
  }

  /**
   * Extract USD value from rawData when the connector didn't supply priceUsd.
   * Works by detecting stablecoin amounts, trade quoteQty, convert ratios, etc.
   */
  private extractUsdFromRawData(record: ExchangeRecord): number | null {
    const raw = record.rawData as any;
    if (!raw) return null;

    // For trades: quoteQty is the USD value if pair is against USD stablecoin
    if (record.type === 'TRADE' || record.type === 'C2C_TRADE') {
      if (raw.quoteQty && record.tradePair) {
        const quote = record.quoteAsset ?? this.extractQuoteFromPair(record.tradePair, record.asset);
        if (quote && isUsdLike(quote)) {
          return parseFloat(raw.quoteQty);
        }
      }
      // For BNB pairs etc, use commission value if available
      return null;
    }

    // For deposits/withdrawals: if asset is a stablecoin, amount = USD value
    if (record.type === 'DEPOSIT' || record.type === 'WITHDRAWAL') {
      if (isUsdLike(record.asset)) {
        return Math.abs(record.amount);
      }
      return null;
    }

    // For converts: check if either side is USD-like
    if (record.type === 'CONVERT') {
      if (raw.toAsset && isUsdLike(raw.toAsset) && raw.toAmount) {
        return parseFloat(raw.toAmount);
      }
      if (raw.fromAsset && isUsdLike(raw.fromAsset) && raw.fromAmount) {
        return parseFloat(raw.fromAmount);
      }
      return null;
    }

    // For dust converts: use transferedAmount as BNB, can't easily USD-price
    if (record.type === 'DUST_CONVERT') {
      // fromAsset amount is typically tiny, not worth pricing
      return null;
    }

    // For staking/earn: if asset is stablecoin, amount = USD value
    if (record.type === 'STAKE' || record.type === 'UNSTAKE' ||
        record.type === 'INTEREST' || record.type === 'DIVIDEND') {
      if (isUsdLike(record.asset)) {
        return Math.abs(record.amount);
      }
      return null;
    }

    // For fiat buy/sell: use sourceAmount/totalValueUsd from connector
    if (record.type === 'FIAT_BUY' || record.type === 'FIAT_SELL') {
      if (raw.sourceAmount) return parseFloat(raw.sourceAmount);
      return null;
    }

    return null;
  }

  private inferCategory(txType: string): string | null {
    const categoryMap: Record<string, string> = {
      EXCHANGE_TRADE: 'DISPOSAL_SWAP',
      EXCHANGE_C2C_TRADE: 'DISPOSAL_SWAP',
      EXCHANGE_DEPOSIT: 'TRANSFER_TO_EXCHANGE',
      EXCHANGE_WITHDRAWAL: 'TRANSFER_FROM_EXCHANGE',
      EXCHANGE_FIAT_BUY: 'DISPOSAL_SWAP',
      EXCHANGE_FIAT_SELL: 'DISPOSAL_SALE',
      EXCHANGE_STAKE: 'TRANSFER_INTERNAL',
      EXCHANGE_UNSTAKE: 'TRANSFER_INTERNAL',
      EXCHANGE_INTEREST: 'INCOME_STAKING_REWARD',
      EXCHANGE_DIVIDEND: 'INCOME_OTHER',
      EXCHANGE_DUST_CONVERT: 'DUST',
      EXCHANGE_CONVERT: 'DISPOSAL_SWAP',
      MARGIN_BORROW: 'DEFI_BORROW',
      MARGIN_REPAY: 'DEFI_REPAY',
      MARGIN_INTEREST: 'FEE',
      MARGIN_LIQUIDATION: 'DISPOSAL_SALE',
    };
    return categoryMap[txType] ?? null;
  }
}
