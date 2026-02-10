import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { TransactionFlow, Prisma } from '@prisma/client';

export interface PortfolioRow {
  mint: string;
  decimals: number;
  totalBought: string;      // all IN amounts (for holdings)
  totalSold: string;        // all OUT amounts (for holdings)
  pricedBought: string;     // only IN amounts with valueUsd (for PnL)
  pricedSold: string;       // only OUT amounts with valueUsd (for PnL)
  totalBoughtUsd: string;
  totalSoldUsd: string;
  buyCount: number;
  sellCount: number;
  firstTx: Date;
  lastTx: Date;
}

export interface PortfolioFilter {
  startDate?: Date;
  endDate?: Date;
  exchangeConnectionIds?: string[];  // include exchange flows by connection
}

@Injectable()
export class TransactionFlowRepository {
  constructor(private prisma: PrismaService) {}

  async createMany(data: Prisma.TransactionFlowCreateManyInput[]): Promise<{ count: number }> {
    return this.prisma.transactionFlow.createMany({
      data,
      skipDuplicates: true,
    });
  }

  async findByTransactionId(transactionId: string): Promise<TransactionFlow[]> {
    return this.prisma.transactionFlow.findMany({
      where: { transactionId },
    });
  }

  async getPortfolioAggregation(
    walletIds: string[],
    filters?: PortfolioFilter,
  ): Promise<PortfolioRow[]> {
    const startDate = filters?.startDate ?? null;
    const endDate = filters?.endDate ?? null;
    const exchangeConnectionIds = filters?.exchangeConnectionIds ?? [];

    // Only aggregate on-chain (wallet) flows for portfolio.
    // Exchange flows are excluded because incomplete sync data causes
    // phantom balances and negative holdings. Exchange holdings will be
    // shown separately once real-time balance fetching is implemented.
    const rows = await this.prisma.$queryRaw<PortfolioRow[]>`
      SELECT
        tf."mint" AS "mint",
        tf."decimals",
        SUM(CASE WHEN tf."direction" = 'IN' THEN tf."amount" ELSE 0 END)::text AS "totalBought",
        SUM(CASE WHEN tf."direction" = 'OUT' THEN tf."amount" ELSE 0 END)::text AS "totalSold",
        SUM(CASE WHEN tf."direction" = 'IN' AND tf."valueUsd" IS NOT NULL THEN tf."amount" ELSE 0 END)::text AS "pricedBought",
        SUM(CASE WHEN tf."direction" = 'OUT' AND tf."valueUsd" IS NOT NULL THEN tf."amount" ELSE 0 END)::text AS "pricedSold",
        SUM(CASE WHEN tf."direction" = 'IN' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END)::text AS "totalBoughtUsd",
        SUM(CASE WHEN tf."direction" = 'OUT' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END)::text AS "totalSoldUsd",
        COUNT(DISTINCT CASE WHEN tf."direction" = 'IN' THEN tf."transactionId" END)::int AS "buyCount",
        COUNT(DISTINCT CASE WHEN tf."direction" = 'OUT' THEN tf."transactionId" END)::int AS "sellCount",
        MIN(t."timestamp") AS "firstTx",
        MAX(t."timestamp") AS "lastTx"
      FROM "transaction_flows" tf
      JOIN "transactions" t ON t."id" = tf."transactionId"
      WHERE tf."walletId" = ANY(${walletIds})
        AND tf."isFee" = false
        AND (${startDate}::timestamp IS NULL OR t."timestamp" >= ${startDate}::timestamp)
        AND (${endDate}::timestamp IS NULL OR t."timestamp" <= ${endDate}::timestamp)
      GROUP BY tf."mint", tf."decimals"
      ORDER BY (
        SUM(CASE WHEN tf."direction" = 'IN' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END)
        + SUM(CASE WHEN tf."direction" = 'OUT' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END)
      ) DESC
    `;

    return rows;
  }

  async getPortfolioForMint(
    walletIds: string[],
    mint: string,
    filters?: PortfolioFilter,
  ): Promise<PortfolioRow | null> {
    const startDate = filters?.startDate ?? null;
    const endDate = filters?.endDate ?? null;
    const exchangeConnectionIds = filters?.exchangeConnectionIds ?? [];

    const rows = await this.prisma.$queryRaw<PortfolioRow[]>`
      SELECT
        tf."mint" AS "mint",
        tf."decimals",
        SUM(CASE WHEN tf."direction" = 'IN' THEN tf."amount" ELSE 0 END)::text AS "totalBought",
        SUM(CASE WHEN tf."direction" = 'OUT' THEN tf."amount" ELSE 0 END)::text AS "totalSold",
        SUM(CASE WHEN tf."direction" = 'IN' AND tf."valueUsd" IS NOT NULL THEN tf."amount" ELSE 0 END)::text AS "pricedBought",
        SUM(CASE WHEN tf."direction" = 'OUT' AND tf."valueUsd" IS NOT NULL THEN tf."amount" ELSE 0 END)::text AS "pricedSold",
        SUM(CASE WHEN tf."direction" = 'IN' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END)::text AS "totalBoughtUsd",
        SUM(CASE WHEN tf."direction" = 'OUT' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END)::text AS "totalSoldUsd",
        COUNT(DISTINCT CASE WHEN tf."direction" = 'IN' THEN tf."transactionId" END)::int AS "buyCount",
        COUNT(DISTINCT CASE WHEN tf."direction" = 'OUT' THEN tf."transactionId" END)::int AS "sellCount",
        MIN(t."timestamp") AS "firstTx",
        MAX(t."timestamp") AS "lastTx"
      FROM "transaction_flows" tf
      JOIN "transactions" t ON t."id" = tf."transactionId"
      WHERE tf."walletId" = ANY(${walletIds})
        AND tf."mint" = ${mint}
        AND tf."isFee" = false
        AND (${startDate}::timestamp IS NULL OR t."timestamp" >= ${startDate}::timestamp)
        AND (${endDate}::timestamp IS NULL OR t."timestamp" <= ${endDate}::timestamp)
      GROUP BY tf."mint", tf."decimals"
    `;

    return rows[0] ?? null;
  }

  /**
   * Aggregate exchange portfolio by exchangeConnectionId.
   * Groups by symbol (falling back to mint), excludes deposits/withdrawals
   * (internal transfers), fee flows, and fiat pseudo-mints.
   */
  async getExchangePortfolioAggregation(
    exchangeConnectionIds: string[],
    filters?: PortfolioFilter,
  ): Promise<PortfolioRow[]> {
    if (exchangeConnectionIds.length === 0) return [];

    const startDate = filters?.startDate ?? null;
    const endDate = filters?.endDate ?? null;

    const rows = await this.prisma.$queryRaw<PortfolioRow[]>`
      SELECT
        COALESCE(tf."symbol", tf."mint") AS "mint",
        tf."decimals",
        SUM(CASE WHEN tf."direction" = 'IN' THEN tf."amount" ELSE 0 END)::text AS "totalBought",
        SUM(CASE WHEN tf."direction" = 'OUT' THEN tf."amount" ELSE 0 END)::text AS "totalSold",
        SUM(CASE WHEN tf."direction" = 'IN' AND tf."valueUsd" IS NOT NULL THEN tf."amount" ELSE 0 END)::text AS "pricedBought",
        SUM(CASE WHEN tf."direction" = 'OUT' AND tf."valueUsd" IS NOT NULL THEN tf."amount" ELSE 0 END)::text AS "pricedSold",
        SUM(CASE WHEN tf."direction" = 'IN' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END)::text AS "totalBoughtUsd",
        SUM(CASE WHEN tf."direction" = 'OUT' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END)::text AS "totalSoldUsd",
        COUNT(DISTINCT CASE WHEN tf."direction" = 'IN' THEN tf."transactionId" END)::int AS "buyCount",
        COUNT(DISTINCT CASE WHEN tf."direction" = 'OUT' THEN tf."transactionId" END)::int AS "sellCount",
        MIN(t."timestamp") AS "firstTx",
        MAX(t."timestamp") AS "lastTx"
      FROM "transaction_flows" tf
      JOIN "transactions" t ON t."id" = tf."transactionId"
      WHERE tf."exchangeConnectionId" = ANY(${exchangeConnectionIds})
        AND tf."isFee" = false
        AND t."type" NOT IN ('EXCHANGE_DEPOSIT', 'EXCHANGE_WITHDRAWAL')
        AND tf."mint" NOT LIKE 'fiat:%'
        AND tf."mint" NOT LIKE 'exchange:%'
        AND tf."mint" != 'native'
        AND COALESCE(tf."symbol", tf."mint") NOT IN (
          'USD', 'BRL', 'EUR', 'GBP', 'AUD', 'CAD', 'JPY', 'TRY', 'RUB', 'NGN',
          'ARS', 'COP', 'KES', 'ZAR', 'INR', 'IDR', 'PHP', 'VND', 'THB', 'MYR'
        )
        AND (${startDate}::timestamp IS NULL OR t."timestamp" >= ${startDate}::timestamp)
        AND (${endDate}::timestamp IS NULL OR t."timestamp" <= ${endDate}::timestamp)
      GROUP BY COALESCE(tf."symbol", tf."mint"), tf."decimals"
      ORDER BY (
        SUM(CASE WHEN tf."direction" = 'IN' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END)
        + SUM(CASE WHEN tf."direction" = 'OUT' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END)
      ) DESC
    `;

    return rows;
  }

  async deleteByWalletId(walletId: string): Promise<{ count: number }> {
    return this.prisma.transactionFlow.deleteMany({
      where: { walletId },
    });
  }

  async countByWalletId(walletId: string): Promise<number> {
    return this.prisma.transactionFlow.count({
      where: { walletId },
    });
  }
}
