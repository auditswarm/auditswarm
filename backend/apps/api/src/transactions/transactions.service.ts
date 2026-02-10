import { Injectable, NotFoundException } from '@nestjs/common';
import {
  TransactionRepository,
  TransactionFlowRepository,
  WalletRepository,
  TokenMetadataRepository,
  PortfolioSnapshotRepository,
  CounterpartyWalletRepository,
  KnownAddressRepository,
  UserAddressLabelRepository,
  ExchangeConnectionRepository,
  TransactionFilter,
} from '@auditswarm/database';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface PortfolioQueryDto {
  walletIds?: string[];
  startDate?: Date;
  endDate?: Date;
  sortBy?: 'volume' | 'pnl' | 'transactions';
  sortOrder?: 'asc' | 'desc';
  includeExchange?: boolean; // include exchange flows in portfolio
}

export interface TransactionQueryDto {
  walletIds?: string[];
  type?: string;
  types?: string[];
  excludeTypes?: string[];
  startDate?: Date;
  endDate?: Date;
  minValue?: number;
  maxValue?: number;
  take?: number;
  skip?: number;
  sortBy?: string;
  sortOrder?: string;
  source?: 'ONCHAIN' | 'EXCHANGE' | 'ALL'; // filter by source
  exchangeConnectionId?: string;
}

@Injectable()
export class TransactionsService {
  constructor(
    private transactionRepository: TransactionRepository,
    private transactionFlowRepository: TransactionFlowRepository,
    private walletRepository: WalletRepository,
    private tokenMetadataRepository: TokenMetadataRepository,
    private portfolioSnapshotRepository: PortfolioSnapshotRepository,
    private counterpartyWalletRepository: CounterpartyWalletRepository,
    private knownAddressRepository: KnownAddressRepository,
    private userAddressLabelRepository: UserAddressLabelRepository,
    private exchangeConnectionRepository: ExchangeConnectionRepository,
  ) {}

  async findByFilter(userId: string, query: TransactionQueryDto) {
    const source = query.source ?? 'ALL';
    let walletIds: string[] = [];

    // For ONCHAIN or ALL, resolve wallet IDs
    if (source !== 'EXCHANGE') {
      if (query.walletIds?.length) {
        for (const walletId of query.walletIds) {
          const wallet = await this.walletRepository.findById(walletId);
          if (!wallet || wallet.userId !== userId) {
            throw new NotFoundException(`Wallet not found: ${walletId}`);
          }
        }
        walletIds = query.walletIds;
      } else {
        const wallets = await this.walletRepository.findByUserId(userId);
        walletIds = wallets.map(w => w.id);
      }
    }

    // For EXCHANGE or ALL, get exchange connection IDs
    let exchangeConnectionIds: string[] = [];
    if (source === 'EXCHANGE' || source === 'ALL') {
      if (query.exchangeConnectionId) {
        exchangeConnectionIds = [query.exchangeConnectionId];
      } else {
        const connections = await this.exchangeConnectionRepository.findByUserId(userId);
        exchangeConnectionIds = connections.map(c => c.id);
      }
    }

    const filter: TransactionFilter = {
      walletIds: walletIds.length > 0 ? walletIds : undefined,
      type: query.type,
      types: query.types,
      excludeTypes: query.excludeTypes,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      minValue: query.minValue != null ? Number(query.minValue) : 0.01,
      maxValue: query.maxValue ? Number(query.maxValue) : undefined,
      source: source !== 'ALL' ? source : undefined,
      exchangeConnectionIds: exchangeConnectionIds.length > 0 ? exchangeConnectionIds : undefined,
    };

    const transactions = await this.transactionRepository.findByFilter(filter, {
      take: query.take ? Number(query.take) : undefined,
      skip: query.skip ? Number(query.skip) : undefined,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder as 'asc' | 'desc' | undefined,
    });

    return this.enrichTransactions(transactions, userId);
  }

  async findById(id: string, userId: string) {
    const transaction = await this.transactionRepository.findById(id);
    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    // Verify ownership: check wallet or exchange connection
    if (transaction.walletId) {
      const wallet = await this.walletRepository.findById(transaction.walletId);
      if (!wallet || wallet.userId !== userId) {
        throw new NotFoundException('Transaction not found');
      }
    } else if ((transaction as any).exchangeConnectionId) {
      const conn = await this.exchangeConnectionRepository.findById(
        (transaction as any).exchangeConnectionId,
      );
      if (!conn || conn.userId !== userId) {
        throw new NotFoundException('Transaction not found');
      }
    } else {
      throw new NotFoundException('Transaction not found');
    }

    const [enriched] = await this.enrichTransactions([transaction], userId);
    return enriched;
  }

  async findBySignature(signature: string, userId: string) {
    const transaction = await this.transactionRepository.findBySignature(signature);
    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    if (transaction.walletId) {
      const wallet = await this.walletRepository.findById(transaction.walletId);
      if (!wallet || wallet.userId !== userId) {
        throw new NotFoundException('Transaction not found');
      }
    }

    const [enriched] = await this.enrichTransactions([transaction], userId);
    return enriched;
  }

  async getStats(userId: string, filter?: TransactionFilter) {
    const wallets = await this.walletRepository.findByUserId(userId);
    const walletIds = wallets.map(w => w.id);

    const count = await this.transactionRepository.countByFilter({
      ...filter,
      walletIds,
    });

    const gainLoss = await this.transactionRepository.getGainLossSum({
      ...filter,
      walletIds,
    });

    return {
      totalTransactions: count,
      totalGains: gainLoss.gains,
      totalLosses: gainLoss.losses,
      netGainLoss: gainLoss.gains - gainLoss.losses,
    };
  }

  async getPortfolio(userId: string, query: PortfolioQueryDto) {
    // 1. Resolve wallets
    const wallets = query.walletIds?.length
      ? await Promise.all(
          query.walletIds.map(async id => {
            const w = await this.walletRepository.findById(id);
            if (!w || w.userId !== userId)
              throw new NotFoundException(`Wallet not found: ${id}`);
            return w;
          }),
        )
      : await this.walletRepository.findByUserId(userId);

    const walletIds = wallets.map(w => w.id);

    // Resolve exchange connections
    let connections: any[] = [];
    if (query.includeExchange !== false) {
      connections = await this.exchangeConnectionRepository.findByUserId(userId);
    }
    const exchangeConnectionIds = connections.map(c => c.id);

    const dateFilters = {
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    };

    // 2. SQL aggregation for on-chain (wallet) portfolio
    const walletRows = walletIds.length > 0
      ? await this.transactionFlowRepository.getPortfolioAggregation(walletIds, dateFilters)
      : [];

    // 3. Build exchange portfolio from cached real-time balances (not flow reconstruction)
    const exchangeBalanceTokens = this.buildExchangeBalanceTokens(connections);

    // 4. Batch-fetch token metadata
    const allMints = [...new Set([...walletRows.map(r => r.mint)])];
    const tokenMetaMap = new Map<string, { symbol: string; name: string; logoUrl: string | null }>();
    if (allMints.length > 0) {
      const metas = await this.tokenMetadataRepository.findByMints(allMints);
      for (const m of metas) {
        tokenMetaMap.set(m.mint, {
          symbol: m.symbol ?? m.mint.slice(0, 6),
          name: m.name ?? 'Unknown',
          logoUrl: m.logoUrl,
        });
      }
    }
    if (!tokenMetaMap.has(SOL_MINT)) {
      tokenMetaMap.set(SOL_MINT, { symbol: 'SOL', name: 'Solana', logoUrl: null });
    }

    // 5. Build on-chain response
    const walletTokens = this.buildPortfolioTokens(walletRows, tokenMetaMap);
    this.sortPortfolioTokens(walletTokens, query);
    this.sortPortfolioTokens(exchangeBalanceTokens, query);

    return {
      wallet: { tokens: walletTokens, summary: this.buildPortfolioSummary(walletTokens) },
      exchange: { tokens: exchangeBalanceTokens, summary: this.buildPortfolioSummary(exchangeBalanceTokens) },
    };
  }

  /**
   * Build exchange portfolio tokens from cached real-time balances.
   * Uses actual API-fetched balances instead of reconstructing from incomplete transaction history.
   */
  private buildExchangeBalanceTokens(connections: any[]) {
    // Aggregate balances across all connections by asset
    const assetMap = new Map<string, { total: number; sources: string[] }>();

    for (const conn of connections) {
      const cached = conn.cachedBalances as any;
      if (!cached?.balances) continue;

      for (const b of cached.balances) {
        const total = (b.free ?? 0) + (b.locked ?? 0);
        if (total <= 0) continue;

        // Normalize LD-prefix tokens (e.g., LDUSD1 → USD1, LDUSDC → USDC)
        let asset = b.asset as string;
        if (asset.startsWith('LD')) asset = asset.slice(2);

        const existing = assetMap.get(asset);
        if (existing) {
          existing.total += total;
          existing.sources.push(b.source);
        } else {
          assetMap.set(asset, { total, sources: [b.source] });
        }
      }
    }

    // Convert to portfolio token format
    const tokens: ReturnType<typeof this.buildPortfolioTokens> = [];
    for (const [asset, { total }] of assetMap) {
      tokens.push({
        mint: asset,
        symbol: asset,
        name: asset,
        logoUrl: null,
        totalBought: total,
        totalSold: 0,
        holdingAmount: total,
        totalBoughtUsd: 0,
        totalSoldUsd: 0,
        realizedPnl: 0,
        avgBuyPrice: 0,
        avgSellPrice: 0,
        totalVolume: 0,
        buyCount: 0,
        sellCount: 0,
        firstTx: new Date(),
        lastTx: new Date(),
      });
    }

    return tokens;
  }

  private buildPortfolioTokens(
    rows: import('@auditswarm/database').PortfolioRow[],
    tokenMetaMap: Map<string, { symbol: string; name: string; logoUrl: string | null }>,
  ) {
    return rows.map(row => {
      // For exchange rows, mint might be a symbol (e.g., "SOL") from COALESCE(symbol, mint)
      const isSymbol = row.mint.length <= 10 && !row.mint.includes('1');
      const meta = tokenMetaMap.get(row.mint) ?? {
        symbol: isSymbol ? row.mint : row.mint.slice(0, 6),
        name: isSymbol ? row.mint : 'Unknown',
        logoUrl: null,
      };
      const totalBought = Number(row.totalBought);
      const totalSold = Number(row.totalSold);
      const pricedBought = Number(row.pricedBought);
      const pricedSold = Number(row.pricedSold);
      const totalBoughtUsd = Number(row.totalBoughtUsd);
      const totalSoldUsd = Number(row.totalSoldUsd);
      const avgBuyPrice = pricedBought > 0 ? totalBoughtUsd / pricedBought : 0;
      const avgSellPrice = pricedSold > 0 ? totalSoldUsd / pricedSold : 0;
      const realizedPnl = totalSoldUsd - avgBuyPrice * pricedSold;
      return {
        mint: row.mint,
        symbol: meta.symbol,
        name: meta.name,
        logoUrl: meta.logoUrl,
        totalBought,
        totalSold,
        holdingAmount: Math.max(0, totalBought - totalSold),
        totalBoughtUsd,
        totalSoldUsd,
        realizedPnl,
        avgBuyPrice,
        avgSellPrice,
        totalVolume: totalBoughtUsd + totalSoldUsd,
        buyCount: row.buyCount,
        sellCount: row.sellCount,
        firstTx: row.firstTx,
        lastTx: row.lastTx,
      };
    });
  }

  private sortPortfolioTokens(tokens: ReturnType<typeof this.buildPortfolioTokens>, query: PortfolioQueryDto) {
    const order = query.sortOrder === 'asc' ? 1 : -1;
    switch (query.sortBy) {
      case 'pnl':
        tokens.sort((a, b) => (a.realizedPnl - b.realizedPnl) * order);
        break;
      case 'transactions':
        tokens.sort((a, b) => ((a.buyCount + a.sellCount) - (b.buyCount + b.sellCount)) * order);
        break;
      case 'volume':
      default:
        tokens.sort((a, b) => (a.totalVolume - b.totalVolume) * order);
        break;
    }
  }

  private buildPortfolioSummary(tokens: ReturnType<typeof this.buildPortfolioTokens>) {
    return {
      totalTokens: tokens.length,
      totalRealizedPnl: tokens.reduce((s, t) => s + t.realizedPnl, 0),
      totalVolumeUsd: tokens.reduce((s, t) => s + t.totalVolume, 0),
      totalBoughtUsd: tokens.reduce((s, t) => s + t.totalBoughtUsd, 0),
      totalSoldUsd: tokens.reduce((s, t) => s + t.totalSoldUsd, 0),
    };
  }

  async getPortfolioToken(userId: string, mint: string, query: PortfolioQueryDto) {
    // 1. Resolve wallets
    const wallets = query.walletIds?.length
      ? await Promise.all(
          query.walletIds.map(async id => {
            const w = await this.walletRepository.findById(id);
            if (!w || w.userId !== userId)
              throw new NotFoundException(`Wallet not found: ${id}`);
            return w;
          }),
        )
      : await this.walletRepository.findByUserId(userId);

    const walletIds = wallets.map(w => w.id);
    if (walletIds.length === 0)
      throw new NotFoundException('No wallets found');

    // 2. Get aggregated summary from TransactionFlow table
    const row = await this.transactionFlowRepository.getPortfolioForMint(walletIds, mint, {
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    });

    const totalBought = row ? Number(row.totalBought) : 0;
    const totalSold = row ? Number(row.totalSold) : 0;
    const pricedBought = row ? Number(row.pricedBought) : 0;
    const pricedSold = row ? Number(row.pricedSold) : 0;
    const totalBoughtUsd = row ? Number(row.totalBoughtUsd) : 0;
    const totalSoldUsd = row ? Number(row.totalSoldUsd) : 0;
    const avgBuyPrice = pricedBought > 0 ? totalBoughtUsd / pricedBought : 0;
    const avgSellPrice = pricedSold > 0 ? totalSoldUsd / pricedSold : 0;
    const realizedPnl = totalSoldUsd - avgBuyPrice * pricedSold;

    // 3. Get token metadata
    const metas = await this.tokenMetadataRepository.findByMints([mint]);
    const meta = metas[0];
    const tokenInfo = meta
      ? { mint, symbol: meta.symbol ?? mint.slice(0, 6), name: meta.name ?? 'Unknown', logoUrl: meta.logoUrl }
      : mint === SOL_MINT
        ? { mint, symbol: 'SOL', name: 'Solana', logoUrl: null }
        : { mint, symbol: mint.slice(0, 6), name: 'Unknown', logoUrl: null };

    // 4. Fetch transactions involving this mint (for the transaction list)
    const filter: TransactionFilter = {
      walletIds,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    };
    const allTxs = await this.transactionRepository.findByFilter(filter, {
      take: 50000,
      sortBy: 'timestamp',
      sortOrder: 'desc',
    });

    // Filter to txs involving this mint
    const txsWithMint = allTxs.filter(tx => {
      const transfers = (tx.transfers as any[] | null) ?? [];
      if (transfers.some((t: any) => t.mint === mint)) return true;
      const rawData = tx.rawData as any;
      const swapEvent = rawData?.events?.swap;
      if (swapEvent) {
        if (mint === SOL_MINT && (swapEvent.nativeInput?.amount || swapEvent.nativeOutput?.amount)) return true;
        for (const ti of swapEvent.tokenInputs ?? []) { if (ti.mint === mint) return true; }
        for (const to of swapEvent.tokenOutputs ?? []) { if (to.mint === mint) return true; }
      }
      return false;
    });

    // 5. Enrich transactions for response
    const enrichedTxs = await this.enrichTransactions(txsWithMint, userId);

    return {
      token: tokenInfo,
      summary: {
        totalBought,
        totalSold,
        holdingAmount: Math.max(0, totalBought - totalSold),
        totalBoughtUsd,
        totalSoldUsd,
        realizedPnl,
        avgBuyPrice,
        avgSellPrice,
      },
      transactions: enrichedTxs,
    };
  }

  async getTaxSummary(
    userId: string,
    options: { taxYear?: number; method?: string },
  ) {
    const method = options.method ?? 'FIFO';
    const snapshots = await this.portfolioSnapshotRepository.findByUser(userId, {
      taxYear: options.taxYear,
      method,
    });

    // Batch-fetch token metadata
    const mints = snapshots.map(s => s.mint);
    const tokenMetaMap = new Map<string, { symbol: string; name: string }>();
    if (mints.length > 0) {
      const metas = await this.tokenMetadataRepository.findByMints(mints);
      for (const m of metas) {
        tokenMetaMap.set(m.mint, { symbol: m.symbol ?? m.mint.slice(0, 6), name: m.name ?? 'Unknown' });
      }
    }
    if (!tokenMetaMap.has(SOL_MINT)) {
      tokenMetaMap.set(SOL_MINT, { symbol: 'SOL', name: 'Solana' });
    }

    const byToken = snapshots.map(s => {
      const meta = tokenMetaMap.get(s.mint);
      return {
        mint: s.mint,
        symbol: meta?.symbol ?? s.mint.slice(0, 6),
        name: meta?.name ?? 'Unknown',
        realizedGainLoss: Number(s.realizedGainLoss),
        shortTermGainLoss: Number(s.shortTermGainLoss),
        longTermGainLoss: Number(s.longTermGainLoss),
        totalProceeds: Number(s.totalProceeds),
        totalCostBasis: Number(s.totalCostBasis),
        remainingAmount: Number(s.remainingAmount),
        isStale: s.isStale,
      };
    });

    return {
      taxYear: options.taxYear ?? new Date().getFullYear(),
      method,
      totalRealizedGainLoss: byToken.reduce((s, t) => s + t.realizedGainLoss, 0),
      shortTermGainLoss: byToken.reduce((s, t) => s + t.shortTermGainLoss, 0),
      longTermGainLoss: byToken.reduce((s, t) => s + t.longTermGainLoss, 0),
      totalProceeds: byToken.reduce((s, t) => s + t.totalProceeds, 0),
      totalCostBasis: byToken.reduce((s, t) => s + t.totalCostBasis, 0),
      byToken,
    };
  }

  // ---- Private helpers ----

  private async enrichTransactions(transactions: any[], userId?: string) {
    if (transactions.length === 0) return [];

    // Collect all unique mints from transfers
    const allMints = new Set<string>();
    // Collect all counterparty addresses for label resolution
    const allAddresses = new Set<string>();

    for (const tx of transactions) {
      const transfers = tx.transfers as any[] | null;
      if (!transfers) continue;
      for (const t of transfers) {
        if (t.mint) allMints.add(t.mint);
        if (t.from) allAddresses.add(t.from);
        if (t.to) allAddresses.add(t.to);
      }
    }

    // Batch-fetch token metadata
    const tokenMap = new Map<string, { symbol: string; name: string; decimals: number; logoUrl: string | null }>();
    if (allMints.size > 0) {
      const tokens = await this.tokenMetadataRepository.findByMints(Array.from(allMints));
      for (const t of tokens) {
        tokenMap.set(t.mint, {
          symbol: t.symbol ?? t.mint.slice(0, 6),
          name: t.name ?? 'Unknown',
          decimals: t.decimals,
          logoUrl: t.logoUrl,
        });
      }
    }
    // Ensure SOL is always available
    if (!tokenMap.has(SOL_MINT)) {
      tokenMap.set(SOL_MINT, { symbol: 'SOL', name: 'Solana', decimals: 9, logoUrl: null });
    }

    // Resolve wallet addresses so we can re-derive transfer directions
    const walletIdSet = [...new Set(transactions.map(tx => tx.walletId).filter(Boolean))];
    const walletResults = await Promise.all(walletIdSet.map(id => this.walletRepository.findById(id)));
    const walletAddressMap = new Map<string, string>();
    for (const w of walletResults) {
      if (w) walletAddressMap.set(w.id, w.address);
    }

    // Build address label map: address → label (priority: user label > counterparty > known address)
    const addressLabelMap = new Map<string, { label: string; entityType?: string }>();
    if (allAddresses.size > 0) {
      const addressList = Array.from(allAddresses);

      // 1. Known addresses (global DB, e.g. Binance, Coinbase)
      const knownAddresses = await this.knownAddressRepository.findAll();
      for (const ka of knownAddresses) {
        addressLabelMap.set(ka.address, { label: ka.label, entityType: ka.entityType });
      }

      // 2. Counterparty labels (from indexer analysis)
      for (const addr of addressList) {
        if (addressLabelMap.has(addr)) continue;
        const cp = await this.counterpartyWalletRepository.findByAddress(addr);
        if (cp?.label) {
          addressLabelMap.set(addr, { label: cp.label, entityType: cp.entityType ?? undefined });
        }
      }

      // 3. User-defined labels (highest priority — overwrites previous)
      if (userId) {
        const userLabels = await this.userAddressLabelRepository.findByUserId(userId);
        for (const ul of userLabels) {
          if (allAddresses.has(ul.address)) {
            addressLabelMap.set(ul.address, { label: ul.label, entityType: ul.entityType ?? undefined });
          }
        }
      }
    }

    return transactions.map(tx => {
      const walletAddress = walletAddressMap.get(tx.walletId) ?? '';
      return this.formatTransaction(tx, tokenMap, walletAddress, addressLabelMap);
    });
  }

  private formatTransaction(
    tx: any,
    tokenMap: Map<string, { symbol: string; name: string; decimals: number; logoUrl: string | null }>,
    walletAddress: string,
    addressLabelMap?: Map<string, { label: string; entityType?: string }>,
  ) {
    const enrichment = tx.enrichment ?? null;
    const transfers = (tx.transfers as any[] | null) ?? [];

    // Match against wallet address AND feePayer (user is usually the fee payer)
    const knownAddrs = new Set(
      [walletAddress, tx.feePayer].filter(Boolean).map((a: string) => a.toLowerCase()),
    );

    // Enrich each transfer with token info + re-derive direction
    const enrichedTransfers = transfers.map((t: any) => {
      const token = tokenMap.get(t.mint) ?? { symbol: t.mint?.slice(0, 6) ?? '???', name: 'Unknown', decimals: 0, logoUrl: null };
      // Check all address fields against wallet + feePayer
      const toFields = [t.to, t.toUserAccount].filter(Boolean).map((a: string) => a.toLowerCase());
      const fromFields = [t.from, t.fromUserAccount].filter(Boolean).map((a: string) => a.toLowerCase());
      const isIn = toFields.some(a => knownAddrs.has(a));
      const isOut = fromFields.some(a => knownAddrs.has(a));
      const direction = isIn ? 'IN' : isOut ? 'OUT' : null;
      const fromInfo = addressLabelMap?.get(t.from);
      const toInfo = addressLabelMap?.get(t.to);
      return {
        from: t.from,
        fromLabel: fromInfo?.label ?? null,
        fromEntityType: fromInfo?.entityType ?? null,
        to: t.to,
        toLabel: toInfo?.label ?? null,
        toEntityType: toInfo?.entityType ?? null,
        direction,
        amount: t.amount,
        mint: t.mint,
        token: {
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
          logoUrl: token.logoUrl,
        },
      };
    });

    // Build type-specific summary
    const summary = this.buildSummary(tx.type, enrichedTransfers, enrichment, tx.rawData, knownAddrs, tokenMap, addressLabelMap);

    return {
      id: tx.id,
      walletId: tx.walletId,
      signature: tx.signature,
      type: tx.type,
      status: tx.status,
      timestamp: tx.timestamp,
      slot: tx.slot,
      blockTime: tx.blockTime,
      fee: tx.fee,
      feePayer: tx.feePayer,
      // Source tracking
      source: tx.source ?? 'ONCHAIN',
      exchangeConnectionId: tx.exchangeConnectionId ?? null,
      exchangeName: tx.exchangeName ?? null,
      externalId: tx.externalId ?? null,
      linkedTransactionId: tx.linkedTransactionId ?? null,
      totalValueUsd: tx.totalValueUsd ? Number(tx.totalValueUsd) : null,
      summary,
      transfers: enrichedTransfers,
      enrichment: enrichment
        ? {
            protocolName: enrichment.protocolName,
            protocolProgramId: enrichment.protocolProgramId,
            heliusType: enrichment.heliusType,
            heliusSource: enrichment.heliusSource,
            swapDetails: enrichment.swapDetails,
            stakingDetails: enrichment.stakingDetails,
            defiDetails: enrichment.defiDetails,
            userLabel: enrichment.userLabel,
            userNotes: enrichment.userNotes,
            aiClassification: enrichment.aiClassification,
            aiConfidence: enrichment.aiConfidence,
            isUnknown: enrichment.isUnknown,
            isFailed: enrichment.isFailed,
          }
        : null,
      costBasis: tx.costBasisMethod
        ? {
            method: tx.costBasisMethod,
            costBasisUsd: tx.costBasisUsd ? Number(tx.costBasisUsd) : null,
            gainLossUsd: tx.gainLossUsd ? Number(tx.gainLossUsd) : null,
            gainLossType: tx.gainLossType,
          }
        : null,
      category: tx.category,
      subcategory: tx.subcategory,
      createdAt: tx.createdAt,
    };
  }

  private buildSummary(
    type: string,
    transfers: any[],
    enrichment: any | null,
    rawData?: any,
    knownAddrs?: Set<string>,
    tokenMap?: Map<string, { symbol: string; name: string; decimals: number; logoUrl: string | null }>,
    addressLabelMap?: Map<string, { label: string; entityType?: string }>,
  ): string {
    const inTransfers = transfers.filter((t: any) => t.direction === 'IN');
    const outTransfers = transfers.filter((t: any) => t.direction === 'OUT');

    switch (type) {
      case 'SWAP': {
        const result = this.buildSwapSummary(transfers, rawData, knownAddrs, tokenMap);
        return result ?? 'Swap';
      }
      case 'TRANSFER_IN': {
        const t = inTransfers[0];
        if (t) {
          const fromLabel = t.fromLabel ?? addressLabelMap?.get(t.from)?.label ?? this.shortAddr(t.from);
          return `Received ${this.fmtAmount(t.amount)} ${t.token.symbol} from ${fromLabel}`;
        }
        return 'Incoming transfer';
      }
      case 'TRANSFER_OUT': {
        const t = outTransfers[0];
        if (t) {
          const toLabel = t.toLabel ?? addressLabelMap?.get(t.to)?.label ?? this.shortAddr(t.to);
          return `Sent ${this.fmtAmount(t.amount)} ${t.token.symbol} to ${toLabel}`;
        }
        return 'Outgoing transfer';
      }
      case 'STAKE': {
        const isLiquid = enrichment?.stakingDetails?.isLiquid;
        const protocol = enrichment?.stakingDetails?.protocol ?? enrichment?.protocolName ?? 'Native';
        const t = outTransfers[0] ?? inTransfers[0];
        const amount = t ? `${this.fmtAmount(t.amount)} ${t.token.symbol}` : '';
        return `Staked ${amount}${isLiquid ? ` via ${protocol} (liquid)` : ''}`.trim();
      }
      case 'UNSTAKE': {
        const protocol = enrichment?.stakingDetails?.protocol ?? enrichment?.protocolName ?? 'Native';
        const t = inTransfers[0] ?? outTransfers[0];
        const amount = t ? `${this.fmtAmount(t.amount)} ${t.token.symbol}` : '';
        return `Unstaked ${amount} from ${protocol}`.trim();
      }
      case 'INTERNAL_TRANSFER': {
        const t = inTransfers[0] ?? outTransfers[0];
        if (t) return `Internal transfer ${this.fmtAmount(t.amount)} ${t.token.symbol}`;
        return 'Internal transfer between own wallets';
      }
      case 'BURN': {
        const t = outTransfers[0];
        if (t) return `Burned ${this.fmtAmount(t.amount)} ${t.token.symbol}`;
        return 'Token burn';
      }
      case 'EXCHANGE_TRADE':
      case 'EXCHANGE_C2C_TRADE': {
        const sold = outTransfers.find(t => !t.isFee);
        const bought = inTransfers[0];
        if (sold && bought) return `Traded ${this.fmtAmount(sold.amount)} ${sold.token?.symbol ?? '?'} for ${this.fmtAmount(bought.amount)} ${bought.token?.symbol ?? '?'}`;
        if (bought) return `Bought ${this.fmtAmount(bought.amount)} ${bought.token?.symbol ?? '?'}`;
        if (sold) return `Sold ${this.fmtAmount(sold.amount)} ${sold.token?.symbol ?? '?'}`;
        return type === 'EXCHANGE_C2C_TRADE' ? 'P2P trade' : 'Exchange trade';
      }
      case 'EXCHANGE_DEPOSIT': {
        const t = inTransfers[0];
        if (t) return `Deposited ${this.fmtAmount(t.amount)} ${t.token?.symbol ?? '?'} to exchange`;
        return 'Exchange deposit';
      }
      case 'EXCHANGE_WITHDRAWAL': {
        const t = outTransfers[0];
        if (t) return `Withdrew ${this.fmtAmount(t.amount)} ${t.token?.symbol ?? '?'} from exchange`;
        return 'Exchange withdrawal';
      }
      case 'EXCHANGE_FIAT_BUY': {
        const t = inTransfers[0];
        if (t) return `Bought ${this.fmtAmount(t.amount)} ${t.token?.symbol ?? '?'} with fiat`;
        return 'Fiat buy';
      }
      case 'EXCHANGE_FIAT_SELL': {
        const t = outTransfers.find(o => !o.isFee);
        if (t) return `Sold ${this.fmtAmount(t.amount)} ${t.token?.symbol ?? '?'} for fiat`;
        return 'Fiat sell';
      }
      case 'EXCHANGE_INTEREST':
      case 'EXCHANGE_DIVIDEND': {
        const t = inTransfers[0];
        if (t) return `Earned ${this.fmtAmount(t.amount)} ${t.token?.symbol ?? '?'} (${type === 'EXCHANGE_DIVIDEND' ? 'dividend' : 'interest'})`;
        return type === 'EXCHANGE_DIVIDEND' ? 'Exchange dividend' : 'Earn reward';
      }
      case 'EXCHANGE_STAKE': {
        const t = outTransfers[0];
        if (t) return `Staked ${this.fmtAmount(t.amount)} ${t.token?.symbol ?? '?'} on exchange`;
        return 'Exchange stake';
      }
      case 'EXCHANGE_UNSTAKE': {
        const t = inTransfers[0];
        if (t) return `Unstaked ${this.fmtAmount(t.amount)} ${t.token?.symbol ?? '?'} from exchange`;
        return 'Exchange unstake';
      }
      case 'EXCHANGE_DUST_CONVERT': {
        const src = outTransfers[0];
        const dst = inTransfers[0];
        if (src && dst) return `Dust convert: ${this.fmtAmount(src.amount)} ${src.token?.symbol ?? '?'} → ${this.fmtAmount(dst.amount)} ${dst.token?.symbol ?? '?'}`;
        return 'Dust conversion';
      }
      case 'EXCHANGE_CONVERT': {
        const src = outTransfers[0];
        const dst = inTransfers[0];
        if (src && dst) return `Converted ${this.fmtAmount(src.amount)} ${src.token?.symbol ?? '?'} to ${this.fmtAmount(dst.amount)} ${dst.token?.symbol ?? '?'}`;
        return 'Exchange convert';
      }
      case 'MARGIN_BORROW': {
        const t = inTransfers[0];
        if (t) return `Borrowed ${this.fmtAmount(t.amount)} ${t.token?.symbol ?? '?'} (margin)`;
        return 'Margin borrow';
      }
      case 'MARGIN_REPAY': {
        const t = outTransfers[0];
        if (t) return `Repaid ${this.fmtAmount(t.amount)} ${t.token?.symbol ?? '?'} (margin)`;
        return 'Margin repay';
      }
      case 'MARGIN_INTEREST': {
        const t = outTransfers[0];
        if (t) return `Margin interest: ${this.fmtAmount(t.amount)} ${t.token?.symbol ?? '?'}`;
        return 'Margin interest';
      }
      case 'MARGIN_LIQUIDATION': {
        return 'Margin liquidation';
      }
      case 'PROGRAM_INTERACTION': {
        const protocol = enrichment?.protocolName;
        const label = protocol ?? 'Program';
        if (outTransfers.length > 0 && inTransfers.length === 0) {
          const t = outTransfers[0];
          return `Sent ${this.fmtAmount(t.amount)} ${t.token?.symbol ?? 'SOL'} · ${label} interaction`;
        }
        if (inTransfers.length > 0 && outTransfers.length === 0) {
          const t = inTransfers[0];
          return `Received ${this.fmtAmount(t.amount)} ${t.token?.symbol ?? 'SOL'} · ${label} interaction`;
        }
        // Fallback: check accountData nativeBalanceChange for direction
        // (BPF Loader refunds appear here, not in nativeTransfers)
        const accountData: any[] = rawData?.accountData ?? [];
        for (const acct of accountData) {
          if (knownAddrs?.has(acct.account?.toLowerCase())) {
            const delta = Number(acct.nativeBalanceChange ?? 0);
            if (delta > 0) {
              return `Received ${this.fmtAmount(delta / 1e9)} SOL · ${label} refund`;
            }
            if (delta < 0) {
              return `Sent ${this.fmtAmount(Math.abs(delta) / 1e9)} SOL · ${label} interaction`;
            }
            break;
          }
        }
        return `${label} interaction`;
      }
      case 'UNKNOWN': {
        const protocol = enrichment?.protocolName;
        if (protocol) return `Interaction with ${protocol}`;
        return 'Unknown transaction';
      }
      default: {
        const protocol = enrichment?.protocolName;
        if (protocol) return `${type} via ${protocol}`;
        return type;
      }
    }
  }

  private buildSwapSummary(
    transfers: any[],
    rawData?: any,
    knownAddrs?: Set<string>,
    tokenMap?: Map<string, { symbol: string; name: string; decimals: number; logoUrl: string | null }>,
  ): string | null {
    const resolve = (mint: string) => tokenMap?.get(mint)?.symbol ?? mint.slice(0, 6);
    const SOL = 'So11111111111111111111111111111111111111112';

    // Strategy 1: events.swap (Jupiter, Raydium — structured input/output)
    const swapEvent = rawData?.events?.swap;
    if (swapEvent) {
      const sentParts: { symbol: string; amount: number }[] = [];
      const recvParts: { symbol: string; amount: number }[] = [];

      if (swapEvent.nativeInput?.amount) {
        sentParts.push({ symbol: 'SOL', amount: Number(swapEvent.nativeInput.amount) / 1e9 });
      }
      if (swapEvent.nativeOutput?.amount) {
        recvParts.push({ symbol: 'SOL', amount: Number(swapEvent.nativeOutput.amount) / 1e9 });
      }
      for (const ti of swapEvent.tokenInputs ?? []) {
        const dec = ti.rawTokenAmount?.decimals ?? 0;
        const amt = Number(ti.rawTokenAmount?.tokenAmount ?? 0) / 10 ** dec;
        if (amt > 0) sentParts.push({ symbol: resolve(ti.mint), amount: amt });
      }
      for (const to of swapEvent.tokenOutputs ?? []) {
        const dec = to.rawTokenAmount?.decimals ?? 0;
        const amt = Number(to.rawTokenAmount?.tokenAmount ?? 0) / 10 ** dec;
        if (amt > 0) recvParts.push({ symbol: resolve(to.mint), amount: amt });
      }

      const sent = sentParts[0];
      const recv = recvParts[0];
      if (sent && recv) {
        return `Swapped ${this.fmtAmount(sent.amount)} ${sent.symbol} for ${this.fmtAmount(recv.amount)} ${recv.symbol}`;
      }
    }

    // Strategy 2: rawData.tokenTransfers + nativeTransfers with fromUserAccount/toUserAccount
    // Aggregate net flow per mint for the user's wallet
    if (rawData && knownAddrs?.size) {
      const byMint = new Map<string, { symbol: string; sent: number; received: number }>();

      for (const tt of rawData.tokenTransfers ?? []) {
        if (!tt.mint || (tt.tokenAmount ?? 0) === 0) continue;
        const fromOwner = (tt.fromUserAccount ?? '').toLowerCase();
        const toOwner = (tt.toUserAccount ?? '').toLowerCase();
        const isSent = knownAddrs.has(fromOwner);
        const isReceived = knownAddrs.has(toOwner);
        if (!isSent && !isReceived) continue;

        const sym = resolve(tt.mint);
        if (!byMint.has(tt.mint)) byMint.set(tt.mint, { symbol: sym, sent: 0, received: 0 });
        const entry = byMint.get(tt.mint)!;
        // tokenAmount is already human-readable (adjusted for decimals)
        if (isSent) entry.sent += tt.tokenAmount;
        if (isReceived) entry.received += tt.tokenAmount;
      }

      for (const nt of rawData.nativeTransfers ?? []) {
        const amount = (nt.amount ?? 0) / 1e9;
        if (amount === 0) continue;
        const from = (nt.fromUserAccount ?? '').toLowerCase();
        const to = (nt.toUserAccount ?? '').toLowerCase();
        const isSent = knownAddrs.has(from);
        const isReceived = knownAddrs.has(to);
        if (!isSent && !isReceived) continue;

        if (!byMint.has(SOL)) byMint.set(SOL, { symbol: 'SOL', sent: 0, received: 0 });
        const entry = byMint.get(SOL)!;
        if (isSent) entry.sent += amount;
        if (isReceived) entry.received += amount;
      }

      // Find tokens with largest net outflow/inflow, excluding SOL if other tokens exist
      // (SOL legs in token↔token swaps are just wrapping/fees, not the actual trade)
      const hasNonSol = [...byMint.keys()].some(k => k !== SOL);
      let sentToken: { symbol: string; amount: number } | null = null;
      let receivedToken: { symbol: string; amount: number } | null = null;
      for (const [mint, v] of byMint) {
        if (hasNonSol && mint === SOL) continue; // skip SOL noise in token↔token swaps
        const net = v.received - v.sent;
        if (net < 0 && (!sentToken || Math.abs(net) > sentToken.amount)) {
          sentToken = { symbol: v.symbol, amount: Math.abs(net) };
        }
        if (net > 0 && (!receivedToken || net > receivedToken.amount)) {
          receivedToken = { symbol: v.symbol, amount: net };
        }
      }

      if (sentToken && receivedToken) {
        return `Swapped ${this.fmtAmount(sentToken.amount)} ${sentToken.symbol} for ${this.fmtAmount(receivedToken.amount)} ${receivedToken.symbol}`;
      }
      // If only non-SOL tokens found but missing one side, retry including SOL
      if (!sentToken || !receivedToken) {
        for (const [, v] of byMint) {
          const net = v.received - v.sent;
          if (net < 0 && (!sentToken || Math.abs(net) > sentToken.amount)) {
            sentToken = { symbol: v.symbol, amount: Math.abs(net) };
          }
          if (net > 0 && (!receivedToken || net > receivedToken.amount)) {
            receivedToken = { symbol: v.symbol, amount: net };
          }
        }
        if (sentToken && receivedToken) {
          return `Swapped ${this.fmtAmount(sentToken.amount)} ${sentToken.symbol} for ${this.fmtAmount(receivedToken.amount)} ${receivedToken.symbol}`;
        }
      }
    }

    // Strategy 3: accountData.tokenBalanceChanges — works for ALL swaps including
    // multi-hop where the user's wallet doesn't appear in tokenTransfers directly.
    // Find the account (userAccount) that has balance changes in 2+ different non-SOL
    // mints — that's the account executing the swap on behalf of the user.
    if (rawData?.accountData?.length) {
      const accountData: any[] = rawData.accountData;

      // Group balance changes by userAccount
      const byOwner = new Map<string, Map<string, { symbol: string; change: number }>>();
      for (const ad of accountData) {
        for (const tbc of ad.tokenBalanceChanges ?? []) {
          const dec = tbc.rawTokenAmount?.decimals ?? 0;
          const raw = Number(tbc.rawTokenAmount?.tokenAmount ?? 0);
          if (raw === 0) continue;
          const mint: string = tbc.mint ?? '';
          if (!mint) continue;
          const owner: string = tbc.userAccount ?? '';
          if (!owner) continue;
          const amount = raw / 10 ** dec;

          if (!byOwner.has(owner)) byOwner.set(owner, new Map());
          const ownerMints = byOwner.get(owner)!;
          if (!ownerMints.has(mint)) ownerMints.set(mint, { symbol: resolve(mint), change: 0 });
          ownerMints.get(mint)!.change += amount;
        }
      }

      // Find the account with 2+ different non-SOL mints (the swap account)
      for (const [, mints] of byOwner) {
        const nonSolMints = [...mints.entries()].filter(([m]) => m !== SOL);
        if (nonSolMints.length < 2) continue;

        let sent3: { symbol: string; amount: number } | null = null;
        let recv3: { symbol: string; amount: number } | null = null;
        for (const [, v] of nonSolMints) {
          if (v.change < 0 && (!sent3 || Math.abs(v.change) > sent3.amount)) {
            sent3 = { symbol: v.symbol, amount: Math.abs(v.change) };
          }
          if (v.change > 0 && (!recv3 || v.change > recv3.amount)) {
            recv3 = { symbol: v.symbol, amount: v.change };
          }
        }
        if (sent3 && recv3) {
          return `Swapped ${this.fmtAmount(sent3.amount)} ${sent3.symbol} for ${this.fmtAmount(recv3.amount)} ${recv3.symbol}`;
        }
      }

      // Fallback: account with 1 non-SOL mint + SOL balance change (SOL↔token swap)
      for (const [, mints] of byOwner) {
        if (mints.size < 2) continue;
        const hasSol = mints.has(SOL);
        const nonSolMints = [...mints.entries()].filter(([m]) => m !== SOL);
        if (!hasSol || nonSolMints.length !== 1) continue;

        const solEntry = mints.get(SOL)!;
        const tokenEntry = nonSolMints[0][1];
        const sent3 = solEntry.change < 0
          ? { symbol: 'SOL', amount: Math.abs(solEntry.change) }
          : { symbol: tokenEntry.symbol, amount: Math.abs(tokenEntry.change) };
        const recv3 = solEntry.change > 0
          ? { symbol: 'SOL', amount: solEntry.change }
          : { symbol: tokenEntry.symbol, amount: tokenEntry.change };
        if (sent3.amount > 0 && recv3.amount > 0) {
          return `Swapped ${this.fmtAmount(sent3.amount)} ${sent3.symbol} for ${this.fmtAmount(recv3.amount)} ${recv3.symbol}`;
        }
      }
    }

    return null;
  }

  private fmtAmount(amount: number): string {
    if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
    if (amount >= 1_000) return `${(amount / 1_000).toFixed(2)}K`;
    if (amount >= 1) return amount.toFixed(4).replace(/\.?0+$/, '');
    if (amount >= 0.0001) return amount.toFixed(6).replace(/0+$/, '');
    return amount.toExponential(2);
  }

  private shortAddr(addr: string): string {
    if (!addr || addr.length < 8) return addr ?? '';
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  }
}
