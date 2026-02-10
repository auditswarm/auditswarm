'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { redirect } from 'next/navigation';
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import {
  PieChart,
  TrendingUp,
  TrendingDown,
  DollarSign,
  BarChart3,
  Coins,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  ArrowLeftRight,
  ExternalLink,
  Flame,
  Droplets,
  Landmark,
  Activity,
  Send,
  Wallet,
  Link2,
} from 'lucide-react';
import { Navbar } from '@/components/dashboard/Sidebar';
import {
  getPortfolio,
  getPortfolioToken,
  type Portfolio,
  type PortfolioSection,
  type PortfolioToken,
  type PortfolioQuery,
  type Transaction,
} from '@/lib/api';

// ─── Animation variants ──────────────────────────────────────────────

const container = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.08 },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────

function formatUsd(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(2)}K`;
  }
  return `$${value.toFixed(2)}`;
}

function formatAmount(value: number): string {
  if (value === 0) return '0';
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`;
  }
  if (Math.abs(value) < 0.01) {
    return value.toFixed(6);
  }
  return value.toFixed(2);
}

function pnlColor(pnl: number): string {
  if (pnl > 0) return 'text-emerald-400';
  if (pnl < 0) return 'text-red-400';
  return 'text-white/30';
}

function pnlSign(pnl: number): string {
  if (pnl > 0) return '+';
  return '';
}

const SORT_OPTIONS: { value: PortfolioQuery['sortBy']; label: string }[] = [
  { value: 'volume', label: 'Volume' },
  { value: 'pnl', label: 'PnL' },
  { value: 'transactions', label: 'Transactions' },
];

type SourceTab = 'all' | 'wallet' | 'exchange';

const SOURCE_TABS: { value: SourceTab; label: string; icon: typeof Wallet }[] = [
  { value: 'all', label: 'All', icon: PieChart },
  { value: 'wallet', label: 'On-Chain', icon: Wallet },
  { value: 'exchange', label: 'Exchange', icon: Link2 },
];

// ─── TX type config (for expanded detail) ────────────────────────────

const TX_TYPE_CONFIG: Record<string, { icon: typeof ArrowLeftRight; label: string; color: string }> = {
  TRANSFER_IN: { icon: ArrowDownRight, label: 'Received', color: 'text-emerald-400' },
  TRANSFER_OUT: { icon: ArrowUpRight, label: 'Sent', color: 'text-orange-400' },
  INTERNAL_TRANSFER: { icon: ArrowLeftRight, label: 'Internal', color: 'text-cyan-400' },
  SWAP: { icon: ArrowLeftRight, label: 'Swap', color: 'text-violet-400' },
  STAKE: { icon: Coins, label: 'Stake', color: 'text-emerald-400' },
  UNSTAKE: { icon: Coins, label: 'Unstake', color: 'text-amber-400' },
  BURN: { icon: Flame, label: 'Burn', color: 'text-red-400' },
  LP_DEPOSIT: { icon: Droplets, label: 'Add LP', color: 'text-blue-400' },
  LP_WITHDRAW: { icon: Droplets, label: 'Remove LP', color: 'text-blue-300' },
  LOAN_BORROW: { icon: Landmark, label: 'Borrow', color: 'text-pink-400' },
  LOAN_REPAY: { icon: Landmark, label: 'Repay', color: 'text-pink-300' },
  PROGRAM_INTERACTION: { icon: Activity, label: 'Interaction', color: 'text-white/40' },
  UNKNOWN: { icon: Activity, label: 'Unknown', color: 'text-white/30' },
};

// ─── Merge helper ───────────────────────────────────────────────────

function mergeSummaries(a: PortfolioSection['summary'], b: PortfolioSection['summary']): PortfolioSection['summary'] {
  return {
    totalTokens: a.totalTokens + b.totalTokens,
    totalRealizedPnl: a.totalRealizedPnl + b.totalRealizedPnl,
    totalVolumeUsd: a.totalVolumeUsd + b.totalVolumeUsd,
    totalBoughtUsd: a.totalBoughtUsd + b.totalBoughtUsd,
    totalSoldUsd: a.totalSoldUsd + b.totalSoldUsd,
  };
}

// ─── Main Page ───────────────────────────────────────────────────────

export default function HoldingsPage() {
  const { connected, publicKey } = useWallet();
  const [sortBy, setSortBy] = useState<PortfolioQuery['sortBy']>('volume');
  const [sortOrder, setSortOrder] = useState<PortfolioQuery['sortOrder']>('desc');
  const [sourceTab, setSourceTab] = useState<SourceTab>('all');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) redirect('/');
  }, [connected]);

  if (!connected || !publicKey) return null;

  const { data: portfolio, isLoading, error } = useQuery({
    queryKey: ['portfolio', sortBy, sortOrder],
    queryFn: () => getPortfolio({ sortBy, sortOrder }),
  });

  // Derive visible tokens and summary based on active tab
  const activeSection = getActiveSection(portfolio, sourceTab);

  return (
    <div className="min-h-screen bg-background">
      <div className="fixed inset-0 pointer-events-none">
        <div className="fixed inset-0 honeycomb-bg opacity-30" />
      </div>

      <Navbar />

      <div className="min-h-screen relative pt-16">
        <motion.main
          variants={container}
          initial="hidden"
          animate="visible"
          className="max-w-[1600px] mx-auto p-5 lg:px-8 lg:py-8 space-y-6"
        >
          {/* Header */}
          <motion.div variants={fadeUp} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold text-white">Holdings</h1>
              <p className="text-sm text-white/30 mt-1">
                Token portfolio breakdown and realized P&L
              </p>
            </div>

            {/* Sort controls */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-white/[0.03] rounded-xl p-1">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSortBy(opt.value)}
                    className={`relative px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      sortBy === opt.value ? 'text-white' : 'text-white/30 hover:text-white/50'
                    }`}
                  >
                    {sortBy === opt.value && (
                      <motion.div
                        layoutId="sort-active"
                        className="absolute inset-0 bg-white/[0.06] rounded-lg"
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      />
                    )}
                    <span className="relative">{opt.label}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
                className="w-9 h-9 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-center text-white/30 hover:text-white/50 transition-colors"
                title={sortOrder === 'desc' ? 'Descending' : 'Ascending'}
              >
                <motion.div animate={{ rotate: sortOrder === 'asc' ? 180 : 0 }} transition={{ duration: 0.2 }}>
                  <ChevronDown className="w-4 h-4" />
                </motion.div>
              </button>
            </div>
          </motion.div>

          {/* Summary Cards */}
          {activeSection?.summary && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <motion.div variants={fadeUp}>
                <SummaryCard
                  icon={Coins}
                  label="Total Tokens"
                  value={String(activeSection.summary.totalTokens)}
                  sub={sourceTab === 'all' ? 'Across on-chain & exchanges' : sourceTab === 'wallet' ? 'On-chain tokens' : 'Exchange tokens'}
                />
              </motion.div>
              <motion.div variants={fadeUp}>
                <SummaryCard
                  icon={BarChart3}
                  label="Total Volume"
                  value={formatUsd(activeSection.summary.totalVolumeUsd)}
                  sub={`${formatUsd(activeSection.summary.totalBoughtUsd)} bought \u00b7 ${formatUsd(activeSection.summary.totalSoldUsd)} sold`}
                />
              </motion.div>
              <motion.div variants={fadeUp}>
                <SummaryCard
                  icon={activeSection.summary.totalRealizedPnl >= 0 ? TrendingUp : TrendingDown}
                  label="Realized PnL"
                  value={`${pnlSign(activeSection.summary.totalRealizedPnl)}${formatUsd(activeSection.summary.totalRealizedPnl)}`}
                  sub={sourceTab === 'all' ? 'Combined P&L' : sourceTab === 'wallet' ? 'On-chain P&L' : 'Exchange P&L'}
                  valueColor={pnlColor(activeSection.summary.totalRealizedPnl)}
                />
              </motion.div>
              <motion.div variants={fadeUp}>
                <SummaryCard
                  icon={DollarSign}
                  label="Avg Token Volume"
                  value={activeSection.summary.totalTokens > 0
                    ? formatUsd(activeSection.summary.totalVolumeUsd / activeSection.summary.totalTokens)
                    : '$0'}
                  sub="Per token average"
                />
              </motion.div>
            </div>
          )}

          {/* Source tabs */}
          <motion.div variants={fadeUp}>
            <div className="flex items-center gap-1 bg-white/[0.03] rounded-xl p-1 w-fit">
              {SOURCE_TABS.map((tab) => {
                const Icon = tab.icon;
                const count = getTabCount(portfolio, tab.value);
                return (
                  <button
                    key={tab.value}
                    onClick={() => { setSourceTab(tab.value); setExpandedKey(null); }}
                    className={`relative flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
                      sourceTab === tab.value ? 'text-white' : 'text-white/30 hover:text-white/50'
                    }`}
                  >
                    {sourceTab === tab.value && (
                      <motion.div
                        layoutId="source-tab-active"
                        className="absolute inset-0 bg-white/[0.06] rounded-lg"
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      />
                    )}
                    <Icon className="w-3.5 h-3.5 relative" />
                    <span className="relative">{tab.label}</span>
                    {count > 0 && (
                      <span className="relative text-[10px] text-white/20 font-mono">{count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>

          {/* Token Table */}
          <motion.div variants={fadeUp}>
            <div className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 overflow-hidden">
              {/* Table header */}
              <div className="hidden lg:grid grid-cols-[48px_1fr_110px_100px_100px_120px_120px_80px_40px] gap-3 px-6 py-3 border-b border-white/5">
                <span />
                <span className="text-[11px] font-medium text-white/20 uppercase tracking-wider">Token</span>
                <span className="text-[11px] font-medium text-white/20 uppercase tracking-wider text-right">Holding</span>
                <span className="text-[11px] font-medium text-white/20 uppercase tracking-wider text-right">Avg Buy</span>
                <span className="text-[11px] font-medium text-white/20 uppercase tracking-wider text-right">Avg Sell</span>
                <span className="text-[11px] font-medium text-white/20 uppercase tracking-wider text-right">Volume</span>
                <span className="text-[11px] font-medium text-white/20 uppercase tracking-wider text-right">PnL</span>
                <span className="text-[11px] font-medium text-white/20 uppercase tracking-wider text-right">Txs</span>
                <span />
              </div>

              {/* Content */}
              {isLoading ? (
                <div className="px-6 py-16 flex flex-col items-center gap-3">
                  <Loader2 className="w-6 h-6 text-primary/50 animate-spin" />
                  <p className="text-sm text-white/30">Loading portfolio...</p>
                </div>
              ) : error ? (
                <div className="px-6 py-16 flex flex-col items-center gap-3">
                  <AlertTriangle className="w-6 h-6 text-red-400" />
                  <p className="text-sm text-white/50">Failed to load portfolio</p>
                  <p className="text-xs text-white/25">{(error as Error).message}</p>
                </div>
              ) : !activeSection?.tokens.length ? (
                <div className="px-6 py-16 flex flex-col items-center gap-3">
                  <PieChart className="w-8 h-8 text-white/10" />
                  <p className="text-sm text-white/30">
                    {sourceTab === 'exchange' ? 'No exchange holdings found' : sourceTab === 'wallet' ? 'No on-chain holdings found' : 'No holdings found'}
                  </p>
                  <p className="text-xs text-white/15">
                    {sourceTab === 'exchange'
                      ? 'Connect an exchange and sync to see exchange holdings here.'
                      : 'Connect and sync wallets to see your token portfolio here.'}
                  </p>
                </div>
              ) : (
                <>
                  {/* Wallet tokens section */}
                  {(sourceTab === 'all' || sourceTab === 'wallet') && portfolio?.wallet.tokens.length ? (
                    <>
                      {sourceTab === 'all' && (
                        <div className="px-6 py-2.5 border-b border-white/5 bg-white/[0.01]">
                          <div className="flex items-center gap-2">
                            <Wallet className="w-3.5 h-3.5 text-white/20" />
                            <span className="text-[11px] font-medium text-white/25 uppercase tracking-wider">On-Chain</span>
                            <span className="text-[10px] font-mono text-white/15">{portfolio.wallet.tokens.length}</span>
                          </div>
                        </div>
                      )}
                      <div className="divide-y divide-white/[0.03]">
                        {portfolio.wallet.tokens.map((token) => (
                          <TokenRow
                            key={`wallet-${token.mint}`}
                            token={token}
                            source="wallet"
                            expanded={expandedKey === `wallet-${token.mint}`}
                            onToggle={() =>
                              setExpandedKey(expandedKey === `wallet-${token.mint}` ? null : `wallet-${token.mint}`)
                            }
                          />
                        ))}
                      </div>
                    </>
                  ) : null}

                  {/* Exchange tokens section */}
                  {(sourceTab === 'all' || sourceTab === 'exchange') && portfolio?.exchange.tokens.length ? (
                    <>
                      {sourceTab === 'all' && (
                        <div className="px-6 py-2.5 border-b border-white/5 bg-white/[0.01]">
                          <div className="flex items-center gap-2">
                            <Link2 className="w-3.5 h-3.5 text-white/20" />
                            <span className="text-[11px] font-medium text-white/25 uppercase tracking-wider">Exchange</span>
                            <span className="text-[10px] font-mono text-white/15">{portfolio.exchange.tokens.length}</span>
                          </div>
                        </div>
                      )}
                      <div className="divide-y divide-white/[0.03]">
                        {portfolio.exchange.tokens.map((token) => (
                          <TokenRow
                            key={`exchange-${token.mint}`}
                            token={token}
                            source="exchange"
                            expanded={expandedKey === `exchange-${token.mint}`}
                            onToggle={() =>
                              setExpandedKey(expandedKey === `exchange-${token.mint}` ? null : `exchange-${token.mint}`)
                            }
                          />
                        ))}
                      </div>
                    </>
                  ) : null}
                </>
              )}

              {/* Footer */}
              {activeSection && activeSection.tokens.length > 0 && (
                <div className="px-6 py-4 border-t border-white/5">
                  <p className="text-xs text-white/20">
                    {activeSection.tokens.length} token{activeSection.tokens.length !== 1 ? 's' : ''} in portfolio
                    {sourceTab === 'all' && portfolio
                      ? ` (${portfolio.wallet.tokens.length} on-chain, ${portfolio.exchange.tokens.length} exchange)`
                      : ''}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </motion.main>
      </div>
    </div>
  );
}

// ─── Derived section helpers ────────────────────────────────────────

function getActiveSection(portfolio: Portfolio | undefined, tab: SourceTab): PortfolioSection | null {
  if (!portfolio) return null;
  if (tab === 'wallet') return portfolio.wallet;
  if (tab === 'exchange') return portfolio.exchange;
  // 'all' — merge both
  return {
    tokens: [...portfolio.wallet.tokens, ...portfolio.exchange.tokens],
    summary: mergeSummaries(portfolio.wallet.summary, portfolio.exchange.summary),
  };
}

function getTabCount(portfolio: Portfolio | undefined, tab: SourceTab): number {
  if (!portfolio) return 0;
  if (tab === 'wallet') return portfolio.wallet.tokens.length;
  if (tab === 'exchange') return portfolio.exchange.tokens.length;
  return portfolio.wallet.tokens.length + portfolio.exchange.tokens.length;
}

// ─── SummaryCard ─────────────────────────────────────────────────────

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  valueColor,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
}) {
  return (
    <div className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 p-5 hover:border-white/10 transition-all">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center">
          <Icon className="w-4 h-4 text-white/40" />
        </div>
        <span className="text-sm text-white/40 font-medium">{label}</span>
      </div>
      <p className={`font-display text-2xl font-bold tracking-tight ${valueColor ?? 'text-white'}`}>
        {value}
      </p>
      <p className="text-xs text-white/25 mt-1">{sub}</p>
    </div>
  );
}

// ─── TokenRow ────────────────────────────────────────────────────────

function TokenRow({
  token,
  source,
  expanded,
  onToggle,
}: {
  token: PortfolioToken;
  source: 'wallet' | 'exchange';
  expanded: boolean;
  onToggle: () => void;
}) {
  const totalTxs = token.buyCount + token.sellCount;

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full group grid grid-cols-1 lg:grid-cols-[48px_1fr_110px_100px_100px_120px_120px_80px_40px] gap-3 items-center px-6 py-4 hover:bg-white/[0.02] transition-colors text-left"
      >
        {/* Logo */}
        <div className="hidden lg:flex w-10 h-10 rounded-xl bg-white/5 items-center justify-center shrink-0 overflow-hidden">
          {token.logoUrl ? (
            <img
              src={token.logoUrl}
              alt={token.symbol}
              className="w-10 h-10 rounded-xl object-cover"
            />
          ) : (
            <Coins className="w-5 h-5 text-white/20" />
          )}
        </div>

        {/* Token info */}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {/* Mobile logo */}
            <div className="lg:hidden w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0 overflow-hidden">
              {token.logoUrl ? (
                <img src={token.logoUrl} alt={token.symbol} className="w-8 h-8 rounded-lg object-cover" />
              ) : (
                <Coins className="w-4 h-4 text-white/20" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-semibold text-white/80">{token.symbol}</p>
                {source === 'exchange' && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-violet-500/10 text-violet-400">
                    CEX
                  </span>
                )}
              </div>
              <p className="text-xs text-white/25 truncate">{token.name}</p>
            </div>
          </div>
        </div>

        {/* Holding */}
        <div className="hidden lg:block text-right">
          <p className="text-sm font-mono text-white/60">{formatAmount(token.holdingAmount)}</p>
        </div>

        {/* Avg Buy */}
        <div className="hidden lg:block text-right">
          <p className="text-sm font-mono text-white/50">{token.avgBuyPrice > 0 ? formatUsd(token.avgBuyPrice) : '\u2014'}</p>
        </div>

        {/* Avg Sell */}
        <div className="hidden lg:block text-right">
          <p className="text-sm font-mono text-white/50">
            {token.avgSellPrice > 0 ? formatUsd(token.avgSellPrice) : '\u2014'}
          </p>
        </div>

        {/* Volume */}
        <div className="hidden lg:block text-right">
          <p className="text-sm font-mono text-white/60">{formatUsd(token.totalVolume)}</p>
          <p className="text-[10px] font-mono text-white/20">
            {formatUsd(token.totalBoughtUsd)} / {formatUsd(token.totalSoldUsd)}
          </p>
        </div>

        {/* PnL */}
        <div className="hidden lg:block text-right">
          <p className={`text-sm font-mono font-medium ${pnlColor(token.realizedPnl)}`}>
            {pnlSign(token.realizedPnl)}{formatUsd(token.realizedPnl)}
          </p>
        </div>

        {/* Tx count */}
        <div className="hidden lg:block text-right">
          <p className="text-sm font-mono text-white/40">{totalTxs}</p>
          <p className="text-[10px] text-white/15">{token.buyCount}B / {token.sellCount}S</p>
        </div>

        {/* Expand chevron */}
        <div className="hidden lg:flex justify-end">
          <motion.div
            animate={{ rotate: expanded ? 90 : 0 }}
            transition={{ duration: 0.2 }}
            className="text-white/15 group-hover:text-white/30 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </motion.div>
        </div>

        {/* Mobile summary */}
        <div className="lg:hidden flex items-center justify-between gap-4 mt-2">
          <div className="flex items-center gap-4 text-xs">
            <span className="text-white/40">
              {formatAmount(token.holdingAmount)} held
            </span>
            <span className="text-white/40">
              Vol {formatUsd(token.totalVolume)}
            </span>
            {source === 'exchange' && (
              <span className="px-1.5 py-0.5 rounded text-[9px] bg-violet-500/10 text-violet-400">CEX</span>
            )}
          </div>
          <span className={`text-xs font-mono font-medium ${pnlColor(token.realizedPnl)}`}>
            {pnlSign(token.realizedPnl)}{formatUsd(token.realizedPnl)}
          </span>
        </div>
      </button>

      {/* Expanded detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <TokenDetail mint={token.mint} symbol={token.symbol} source={source} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── TokenDetail (expanded) ──────────────────────────────────────────

function TokenDetail({ mint, symbol, source }: { mint: string; symbol: string; source: 'wallet' | 'exchange' }) {
  const { data, isLoading } = useQuery({
    queryKey: ['portfolio-token', mint],
    queryFn: () => getPortfolioToken(mint),
    // Exchange tokens with non-base58 mints (e.g. "USDC") may not have detail endpoint
    enabled: source === 'wallet',
  });

  if (source === 'exchange') {
    return (
      <div className="px-6 py-6 border-t border-white/5 bg-white/[0.01] flex items-center justify-center gap-2">
        <Link2 className="w-4 h-4 text-white/15" />
        <span className="text-xs text-white/25">Exchange transaction details available in the exchange import view</span>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="px-6 py-8 flex items-center justify-center border-t border-white/5 bg-white/[0.01]">
        <Loader2 className="w-4 h-4 text-primary/40 animate-spin mr-2" />
        <span className="text-xs text-white/25">Loading {symbol} transactions...</span>
      </div>
    );
  }

  if (!data) return null;

  const { summary, transactions } = data;

  return (
    <div className="border-t border-white/5 bg-white/[0.01]">
      {/* Token summary stats */}
      <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4 border-b border-white/[0.03]">
        <MiniStat label="Total Bought" value={formatAmount(summary.totalBought)} sub={formatUsd(summary.totalBoughtUsd)} />
        <MiniStat label="Total Sold" value={formatAmount(summary.totalSold)} sub={formatUsd(summary.totalSoldUsd)} />
        <MiniStat label="Avg Buy Price" value={formatUsd(summary.avgBuyPrice)} />
        <MiniStat label="Avg Sell Price" value={summary.avgSellPrice > 0 ? formatUsd(summary.avgSellPrice) : '\u2014'} />
      </div>

      {/* Transaction list */}
      {transactions.length === 0 ? (
        <div className="px-6 py-6 text-center">
          <p className="text-xs text-white/20">No transactions for this token</p>
        </div>
      ) : (
        <div className="divide-y divide-white/[0.02]">
          {transactions.slice(0, 10).map((tx) => (
            <TokenTxRow key={tx.id} tx={tx} />
          ))}
          {transactions.length > 10 && (
            <div className="px-6 py-3 text-center">
              <p className="text-xs text-white/20">
                +{transactions.length - 10} more transactions
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[10px] text-white/20 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-sm font-mono text-white/60">{value}</p>
      {sub && <p className="text-[10px] font-mono text-white/20 mt-0.5">{sub}</p>}
    </div>
  );
}

function getTxDirection(tx: Transaction): 'in' | 'out' | 'neutral' {
  switch (tx.type) {
    case 'TRANSFER_IN':
    case 'UNSTAKE':
      return 'in';
    case 'TRANSFER_OUT':
    case 'BURN':
    case 'STAKE':
      return 'out';
    case 'PROGRAM_INTERACTION': {
      if (tx.summary?.startsWith('Received')) return 'in';
      if (tx.summary?.startsWith('Sent')) return 'out';
      return 'neutral';
    }
    default:
      return 'neutral';
  }
}

function TokenTxRow({ tx }: { tx: Transaction }) {
  const config = TX_TYPE_CONFIG[tx.type] ?? TX_TYPE_CONFIG.UNKNOWN;
  const Icon = config.icon;
  const date = new Date(tx.timestamp);
  const protocol = tx.enrichment?.protocolName;
  const direction = getTxDirection(tx);

  const valueColor =
    direction === 'in' ? 'text-emerald-400' : direction === 'out' ? 'text-orange-400' : 'text-white/50';
  const valuePrefix = direction === 'in' ? '+' : direction === 'out' ? '-' : '';

  // For swaps, show the token flow
  let flowLabel: string | null = null;
  if (tx.type === 'SWAP' && tx.transfers?.length >= 2) {
    const out = tx.transfers.find((t) => t.direction === 'OUT');
    const inn = tx.transfers.find((t) => t.direction === 'IN');
    if (out && inn) flowLabel = `${out.token?.symbol ?? '?'} \u2192 ${inn.token?.symbol ?? '?'}`;
  }

  return (
    <div className="grid grid-cols-[32px_1fr_120px_100px] gap-3 items-center px-6 py-3 hover:bg-white/[0.015] transition-colors">
      <div className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center">
        <Icon className={`w-3.5 h-3.5 ${config.color}`} />
      </div>

      <div className="min-w-0">
        <p className="text-xs text-white/60 truncate">{tx.summary || config.label}</p>
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] ${config.color}`}>{config.label}</span>
          {flowLabel && (
            <>
              <span className="text-white/10">&middot;</span>
              <span className="text-[10px] text-white/25">{flowLabel}</span>
            </>
          )}
          {!flowLabel && protocol && (
            <>
              <span className="text-white/10">&middot;</span>
              <span className="text-[10px] text-white/20">{protocol}</span>
            </>
          )}
        </div>
      </div>

      <div className="text-right">
        <p className="text-xs text-white/40">
          {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </p>
        <p className="text-[10px] text-white/15">
          {date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
        </p>
      </div>

      <div className="text-right">
        {tx.totalValueUsd != null ? (
          <p className={`text-xs font-mono font-medium ${valueColor}`}>
            {valuePrefix}${tx.totalValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        ) : (
          <p className="text-xs font-mono text-white/15">&mdash;</p>
        )}
      </div>
    </div>
  );
}
