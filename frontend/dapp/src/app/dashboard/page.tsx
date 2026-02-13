'use client';

import { useState, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { redirect } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Wallet,
  Plus,
  ArrowRight,
  Shield,
  Activity,
  ChevronDown,
  ArrowLeftRight,
  ArrowDownRight,
  ArrowUpRight,
  Coins,
  TrendingUp,
  TrendingDown,
  Copy,
  RefreshCw,
  Flame,
  Droplets,
  Landmark,
  Link2,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  X,
  ExternalLink,
  Eye,
  EyeOff,
  Key,
  PieChart,
  FileSearch,
  Check,
  DollarSign,
  BarChart3,
} from 'lucide-react';
import { Navbar } from '@/components/dashboard/Sidebar';

import { ChatWidget } from '@/components/dashboard/ChatWidget';

import {
  listWallets,
  getTransactionStats,
  queryTransactions,
  getPortfolio,
  listAudits,
  getAuditResult,
  listExchangeConnections,
  getAvailableExchanges,
  linkExchange,
  syncExchangeConnection,
  deleteExchangeConnection,
  syncWallet,
  getSyncStatus,
  type Transaction,
  type ExchangeConnection,
  type AvailableExchange,
  type PortfolioToken,
  type Audit,
  type AuditResult,
  type SyncStatus,
  type Wallet as WalletType,
} from '@/lib/api';

// ─── Animations ─────────────────────────────────────────────────────

const container = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.08 },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

// ─── Helpers ────────────────────────────────────────────────────────

function formatUsd(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  if (Math.abs(value) < 0.01 && value !== 0) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatAmount(value: number): string {
  if (value === 0) return '0';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  if (Math.abs(value) < 0.001) return value.toFixed(6);
  if (Math.abs(value) < 1) return value.toFixed(4);
  return value.toFixed(2);
}

function truncateAddress(addr: string, chars = 4): string {
  if (addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
}

function formatCurrency(value: number | string | null | undefined, currency = 'USD'): string {
  const n = Number(value) || 0;
  const sym = currency === 'BRL' ? 'R$' : currency === 'EUR' ? '\u20AC' : '$';
  if (Math.abs(n) >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${sym}${(n / 1_000).toFixed(1)}K`;
  return `${sym}${n.toFixed(2)}`;
}

// ─── TX type config ─────────────────────────────────────────────────

const TX_TYPE_CONFIG: Record<Transaction['type'], { icon: typeof ArrowLeftRight; label: string; color: string }> = {
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

const JURISDICTION_FLAGS: Record<string, string> = {
  US: '\u{1F1FA}\u{1F1F8}',
  EU: '\u{1F1EA}\u{1F1FA}',
  BR: '\u{1F1E7}\u{1F1F7}',
};

// ─── Main Dashboard ─────────────────────────────────────────────────

export default function Dashboard() {
  const { connected, publicKey } = useWallet();
  const [showConnectExchange, setShowConnectExchange] = useState(false);

  useEffect(() => {
    if (!connected) redirect('/');
  }, [connected]);

  if (!connected || !publicKey) return null;


  const { data: wallets } = useQuery({
    queryKey: ['wallets'],
    queryFn: listWallets,
    retry: 1,
  });

  const { data: portfolio } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => getPortfolio({ sortBy: 'volume', sortOrder: 'desc' }),
    retry: 1,
  });

  const { data: txStats } = useQuery({
    queryKey: ['transaction-stats'],
    queryFn: () => getTransactionStats(),
    retry: 1,
  });

  const { data: recentTxs, isLoading: txsLoading } = useQuery({
    queryKey: ['recent-transactions'],
    queryFn: () => queryTransactions({ take: 8, excludeTypes: ['UNKNOWN', 'PROGRAM_INTERACTION'] }),
    retry: 1,
  });

  const { data: exchangeConnections } = useQuery({
    queryKey: ['exchange-connections'],
    queryFn: listExchangeConnections,
    retry: 1,
  });

  const { data: audits } = useQuery({
    queryKey: ['audits'],
    queryFn: () => listAudits({ take: 5 }),
    retry: 1,
    refetchInterval: (query) => {
      const data = query.state.data as Audit[] | undefined;
      const hasActive = data?.some((a) => ['QUEUED', 'PENDING', 'PROCESSING'].includes(a.status));
      return hasActive ? 5000 : 60000;
    },
  });

  // ─── Derived ───
  const walletCount = wallets?.length ?? 0;
  const exchangeCount = exchangeConnections?.length ?? 0;
  const totalTxCount = wallets?.reduce((sum, w) => sum + w.transactionCount, 0) ?? 0;
  const walletMap = new Map<string, { label: string | null; address: string }>();
  wallets?.forEach((w) => walletMap.set(w.id, { label: w.label, address: w.address }));

  const totalPortfolioVolume = portfolio
    ? portfolio.wallet.summary.totalVolumeUsd + portfolio.exchange.summary.totalVolumeUsd
    : 0;

  const totalPnl = portfolio
    ? portfolio.wallet.summary.totalRealizedPnl + portfolio.exchange.summary.totalRealizedPnl
    : 0;

  // Split tokens into active (has balance) vs traded (zero balance but has volume)
  const { activeOnChain, tradedOnChain, activeExchange, tradedExchange } = useMemo(() => {
    if (!portfolio) return { activeOnChain: [], tradedOnChain: [], activeExchange: [], tradedExchange: [] };
    const walletTokens = portfolio.wallet.tokens;
    const exchangeTokens = portfolio.exchange.tokens;
    return {
      activeOnChain: walletTokens.filter((t) => t.holdingAmount > 0.000001),
      tradedOnChain: walletTokens.filter((t) => t.holdingAmount <= 0.000001 && t.totalVolume > 0),
      activeExchange: exchangeTokens.filter((t) => t.holdingAmount > 0.000001),
      tradedExchange: exchangeTokens.filter((t) => t.holdingAmount <= 0.000001 && t.totalVolume > 0),
    };
  }, [portfolio]);

  const totalActiveTokens = activeOnChain.length + activeExchange.length;

  return (
    <div className="min-h-screen bg-background">
      <div className="fixed inset-0 pointer-events-none">
        <div className="fixed inset-0 honeycomb-bg opacity-30" />
        <div className="fixed inset-0 bg-gradient-to-b from-primary/[0.02] via-transparent to-transparent" />
      </div>

      <Navbar />

      <div className="min-h-screen relative pt-16">
        <motion.main
          variants={container}
          initial="hidden"
          animate="visible"
          className="max-w-[1600px] mx-auto px-5 lg:px-8 py-6 space-y-5"
        >
          {/* ─── Stats ─────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <motion.div variants={fadeUp}>
              <StatCard
                label="Portfolio Volume"
                value={totalPortfolioVolume > 0 ? formatUsd(totalPortfolioVolume) : '--'}
                sub={totalActiveTokens > 0 ? `${totalActiveTokens} active holdings` : 'Sync wallets to start'}
                icon={PieChart}
                accent="gold"
              />
            </motion.div>
            <motion.div variants={fadeUp}>
              <StatCard
                label="Realized P&L"
                value={totalPnl !== 0 ? `${totalPnl > 0 ? '+' : ''}${formatUsd(totalPnl)}` : '--'}
                sub={totalPnl > 0 ? 'Net profit' : totalPnl < 0 ? 'Net loss' : 'No trades yet'}
                icon={totalPnl >= 0 ? TrendingUp : TrendingDown}
                accent={totalPnl > 0 ? 'green' : totalPnl < 0 ? 'red' : 'neutral'}
              />
            </motion.div>
            <motion.div variants={fadeUp}>
              <StatCard
                label="Wallets"
                value={String(walletCount)}
                sub={`${totalTxCount.toLocaleString()} transactions`}
                icon={Wallet}
                accent="blue"
              />
            </motion.div>
            <motion.div variants={fadeUp}>
              <StatCard
                label="Exchanges"
                value={String(exchangeCount)}
                sub={exchangeCount > 0 ? `${exchangeCount} connected` : 'None linked'}
                icon={Link2}
                accent="purple"
              />
            </motion.div>
          </div>

          {/* ─── Wallets (single row) ────────────────── */}
          <WalletsRow wallets={wallets ?? []} totalTxCount={totalTxCount} />

          {/* ─── Holdings ──────────────────────────────── */}
          {portfolio && (activeOnChain.length > 0 || activeExchange.length > 0 || tradedOnChain.length > 0 || tradedExchange.length > 0) && (
            <motion.div variants={fadeUp}>
              <div className="rounded-2xl bg-surface/60 backdrop-blur-md border border-white/[0.06] overflow-hidden shadow-lg shadow-black/20">
                <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/10">
                      <Coins className="w-4.5 h-4.5 text-primary" />
                    </div>
                    <div>
                      <h2 className="font-display text-[15px] font-bold text-white">Holdings</h2>
                      <p className="text-[11px] text-white/30">
                        {totalActiveTokens} active{' '}
                        {(tradedOnChain.length + tradedExchange.length) > 0 && (
                          <span className="text-white/15">&middot; {tradedOnChain.length + tradedExchange.length} previously traded</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <Link
                    href="/holdings"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-primary/70 hover:text-primary hover:bg-primary/5 transition-all font-medium"
                  >
                    View all
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>

                {/* On-chain active holdings */}
                {activeOnChain.length > 0 && (
                  <div>
                    <div className="px-5 py-2.5 bg-white/[0.015] border-b border-white/[0.04] flex items-center gap-2">
                      <Wallet className="w-3 h-3 text-primary/30" />
                      <span className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">On-Chain</span>
                      <span className="ml-auto text-[10px] font-mono text-white/15">{activeOnChain.length} tokens</span>
                    </div>
                    <div className="p-3.5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                        {activeOnChain.slice(0, 8).map((token) => (
                          <TokenCard key={`w-${token.mint}`} token={token} />
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* On-chain traded (zero balance) — compact strip */}
                {tradedOnChain.length > 0 && (
                  <TradedTokensStrip
                    tokens={tradedOnChain}
                    label="on-chain"
                    icon={<Wallet className="w-3 h-3 text-white/15" />}
                  />
                )}

                {/* Exchange active holdings */}
                {activeExchange.length > 0 && (
                  <div>
                    <div className="px-5 py-2.5 bg-white/[0.015] border-b border-white/[0.04] flex items-center gap-2">
                      <Link2 className="w-3 h-3 text-violet-400/30" />
                      <span className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">Exchange</span>
                      <span className="ml-auto text-[10px] font-mono text-white/15">{activeExchange.length} tokens</span>
                    </div>
                    <div className="p-3.5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                        {activeExchange.slice(0, 8).map((token) => (
                          <TokenCard key={`e-${token.mint}`} token={token} exchange />
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Exchange traded (zero balance) — compact strip */}
                {tradedExchange.length > 0 && (
                  <TradedTokensStrip
                    tokens={tradedExchange}
                    label="exchange"
                    icon={<Link2 className="w-3 h-3 text-white/15" />}
                  />
                )}
              </div>
            </motion.div>
          )}

          {/* ─── Main Content: Transactions + Sidebar ─── */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            {/* Transactions */}
            <motion.div variants={fadeUp} className="xl:col-span-2">
              <div className="rounded-2xl bg-surface/60 backdrop-blur-md border border-white/[0.06] overflow-hidden shadow-lg shadow-black/20">
                <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500/15 to-cyan-500/5 flex items-center justify-center border border-cyan-500/10">
                      <Activity className="w-4.5 h-4.5 text-cyan-400" />
                    </div>
                    <h2 className="font-display text-[15px] font-bold text-white">Recent Activity</h2>
                  </div>
                  <span className="text-[10px] text-white/20 font-mono bg-white/[0.03] px-2.5 py-1 rounded-md">
                    {totalTxCount.toLocaleString()} total
                  </span>
                </div>

                <div className="hidden md:grid grid-cols-[1fr_120px_100px_120px_70px] gap-3 px-5 py-2.5 border-b border-white/[0.03]">
                  <span className="text-[10px] font-semibold text-white/20 uppercase tracking-wider">Type</span>
                  <span className="text-[10px] font-semibold text-white/20 uppercase tracking-wider">Wallet</span>
                  <span className="text-[10px] font-semibold text-white/20 uppercase tracking-wider">Date</span>
                  <span className="text-[10px] font-semibold text-white/20 uppercase tracking-wider text-right">Value</span>
                  <span className="text-[10px] font-semibold text-white/20 uppercase tracking-wider text-right">Status</span>
                </div>

                <div className="divide-y divide-white/[0.03]">
                  {txsLoading ? (
                    <div className="px-5 py-12 flex flex-col items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-white/15 animate-spin" />
                      <p className="text-xs text-white/20">Loading...</p>
                    </div>
                  ) : !recentTxs?.length ? (
                    <div className="px-5 py-12 flex flex-col items-center gap-2">
                      <Activity className="w-5 h-5 text-white/10" />
                      <p className="text-xs text-white/20">No transactions yet</p>
                    </div>
                  ) : (
                    recentTxs.map((tx) => (
                      <TransactionRow key={tx.id} tx={tx} walletInfo={walletMap.get(tx.walletId)} />
                    ))
                  )}
                </div>

                {recentTxs && recentTxs.length > 0 && (
                  <div className="px-5 py-3 border-t border-white/[0.03] flex items-center justify-between">
                    <p className="text-[10px] text-white/15">
                      Showing {recentTxs.length} of {totalTxCount.toLocaleString()}
                    </p>
                    <Link
                      href="/holdings"
                      className="text-[11px] text-primary/60 hover:text-primary flex items-center gap-1 transition-colors font-medium"
                    >
                      View all <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>
                )}
              </div>
            </motion.div>

            {/* Right column */}
            <motion.div variants={fadeUp} className="space-y-5">
              <AuditsPanel audits={audits ?? []} />
              <ExchangePanel
                connections={exchangeConnections ?? []}
                onConnect={() => setShowConnectExchange(true)}
              />
            </motion.div>
          </div>

          <ChatWidget />
        </motion.main>
      </div>

      <AnimatePresence>
        {showConnectExchange && (
          <ConnectExchangeModal onClose={() => setShowConnectExchange(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── StatCard ───────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: 'gold' | 'green' | 'red' | 'blue' | 'purple' | 'neutral';
}) {
  const styles: Record<string, { gradient: string; border: string; icon: string; iconBg: string; value: string; glow: string }> = {
    gold: {
      gradient: 'from-primary/[0.06] via-surface/60 to-surface/60',
      border: 'border-primary/15 hover:border-primary/25',
      icon: 'text-primary',
      iconBg: 'bg-gradient-to-br from-primary/20 to-primary/5',
      value: 'text-white',
      glow: 'shadow-primary/5',
    },
    green: {
      gradient: 'from-emerald-500/[0.06] via-surface/60 to-surface/60',
      border: 'border-emerald-500/15 hover:border-emerald-500/25',
      icon: 'text-emerald-400',
      iconBg: 'bg-gradient-to-br from-emerald-500/20 to-emerald-500/5',
      value: 'text-emerald-400',
      glow: 'shadow-emerald-500/5',
    },
    red: {
      gradient: 'from-red-500/[0.06] via-surface/60 to-surface/60',
      border: 'border-red-500/15 hover:border-red-500/25',
      icon: 'text-red-400',
      iconBg: 'bg-gradient-to-br from-red-500/20 to-red-500/5',
      value: 'text-red-400',
      glow: 'shadow-red-500/5',
    },
    blue: {
      gradient: 'from-blue-500/[0.06] via-surface/60 to-surface/60',
      border: 'border-blue-500/15 hover:border-blue-500/25',
      icon: 'text-blue-400',
      iconBg: 'bg-gradient-to-br from-blue-500/15 to-blue-500/5',
      value: 'text-white',
      glow: 'shadow-blue-500/5',
    },
    purple: {
      gradient: 'from-violet-500/[0.06] via-surface/60 to-surface/60',
      border: 'border-violet-500/15 hover:border-violet-500/25',
      icon: 'text-violet-400',
      iconBg: 'bg-gradient-to-br from-violet-500/15 to-violet-500/5',
      value: 'text-white',
      glow: 'shadow-violet-500/5',
    },
    neutral: {
      gradient: 'from-white/[0.02] via-surface/60 to-surface/60',
      border: 'border-white/[0.06] hover:border-white/10',
      icon: 'text-white/40',
      iconBg: 'bg-white/[0.06]',
      value: 'text-white',
      glow: '',
    },
  };
  const s = styles[accent];

  return (
    <div className={`relative rounded-xl bg-gradient-to-br ${s.gradient} backdrop-blur-md border ${s.border} p-4 transition-all shadow-lg ${s.glow} group overflow-hidden`}>
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative">
        <div className="flex items-center gap-2.5 mb-3">
          <div className={`w-8 h-8 rounded-lg ${s.iconBg} flex items-center justify-center border border-white/[0.04]`}>
            <Icon className={`w-3.5 h-3.5 ${s.icon}`} />
          </div>
          <span className="text-[11px] text-white/40 font-semibold uppercase tracking-wider">{label}</span>
        </div>
        <p className={`font-display text-[26px] font-bold tracking-tight ${s.value} leading-none`}>{value}</p>
        <p className="text-[11px] text-white/25 mt-1.5">{sub}</p>
      </div>
    </div>
  );
}

// ─── TokenCard ──────────────────────────────────────────────────────

function TokenCard({ token, exchange }: { token: PortfolioToken; exchange?: boolean }) {
  const pnl = token.realizedPnl;
  const pnlColor = pnl > 0 ? 'text-emerald-400' : pnl < 0 ? 'text-red-400' : 'text-white/20';
  const accentBar = pnl > 0 ? 'from-emerald-500/40 to-emerald-500/0' : pnl < 0 ? 'from-red-500/40 to-red-500/0' : 'from-white/5 to-transparent';

  return (
    <Link
      href="/holdings"
      className="group relative flex items-center gap-3 rounded-xl bg-white/[0.025] border border-white/[0.05] px-3.5 py-3 hover:border-white/[0.12] hover:bg-white/[0.04] transition-all"
    >
      {/* Left accent */}
      <div className={`absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-gradient-to-b ${accentBar}`} />

      {/* Token icon */}
      <div className="w-10 h-10 rounded-xl bg-white/[0.06] flex items-center justify-center shrink-0 overflow-hidden border border-white/[0.04] group-hover:border-white/[0.08] transition-colors">
        {token.logoUrl ? (
          <img src={token.logoUrl} alt={token.symbol} className="w-10 h-10 rounded-xl object-cover" />
        ) : (
          <span className="text-[11px] font-mono font-bold text-white/25">
            {token.symbol.slice(0, 3)}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-sm font-semibold text-white/85 truncate">{token.symbol}</span>
          {exchange && (
            <span className="px-1 py-[1px] rounded text-[7px] font-bold bg-violet-500/15 text-violet-400 shrink-0 uppercase tracking-wider">
              cex
            </span>
          )}
        </div>
        <p className="text-[10px] text-white/20 truncate">{token.name}</p>
      </div>

      {/* Numbers */}
      <div className="text-right shrink-0">
        <p className="text-sm font-mono font-semibold text-white/80">{formatAmount(token.holdingAmount)}</p>
        <div className="flex items-center justify-end gap-1.5 mt-0.5">
          <span className="text-[10px] font-mono text-white/25">{formatUsd(token.totalVolume)}</span>
          {pnl !== 0 && (
            <>
              <span className="text-white/10">&middot;</span>
              <span className={`text-[10px] font-mono font-medium ${pnlColor}`}>
                {pnl > 0 ? '+' : ''}{formatUsd(pnl)}
              </span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}

// ─── TradedTokensStrip (zero-balance grouping) ─────────────────────

function TradedTokensStrip({
  tokens,
  label,
  icon,
}: {
  tokens: PortfolioToken[];
  label: string;
  icon: React.ReactNode;
}) {
  const totalVolume = tokens.reduce((sum, t) => sum + t.totalVolume, 0);
  const totalPnl = tokens.reduce((sum, t) => sum + t.realizedPnl, 0);

  return (
    <Link
      href="/holdings"
      className="group flex items-center gap-3 px-5 py-3 border-t border-white/[0.03] hover:bg-white/[0.02] transition-colors"
    >
      {/* Stacked token avatars */}
      <div className="flex items-center -space-x-2.5">
        {tokens.slice(0, 5).map((t, i) => (
          <div
            key={t.mint}
            className="w-7 h-7 rounded-full bg-surface border-2 border-surface flex items-center justify-center overflow-hidden shrink-0"
            style={{ zIndex: 10 - i }}
          >
            {t.logoUrl ? (
              <img src={t.logoUrl} alt={t.symbol} className="w-7 h-7 rounded-full object-cover" />
            ) : (
              <span className="text-[8px] font-mono font-bold text-white/25 bg-white/[0.06] w-full h-full flex items-center justify-center">
                {t.symbol.slice(0, 2)}
              </span>
            )}
          </div>
        ))}
        {tokens.length > 5 && (
          <div
            className="w-7 h-7 rounded-full bg-white/[0.06] border-2 border-surface flex items-center justify-center shrink-0"
            style={{ zIndex: 4 }}
          >
            <span className="text-[9px] font-mono font-bold text-white/40">+{tokens.length - 5}</span>
          </div>
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-white/35">
          <span className="font-semibold text-white/45">{tokens.length}</span> {label} tokens previously traded
        </p>
      </div>

      {/* Volume + PnL */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right">
          <p className="text-[10px] text-white/20">Volume</p>
          <p className="text-[11px] font-mono text-white/30">{formatUsd(totalVolume)}</p>
        </div>
        {totalPnl !== 0 && (
          <div className="text-right">
            <p className="text-[10px] text-white/20">P&L</p>
            <p className={`text-[11px] font-mono font-medium ${totalPnl > 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
              {totalPnl > 0 ? '+' : ''}{formatUsd(totalPnl)}
            </p>
          </div>
        )}
        <ArrowRight className="w-3 h-3 text-white/10 group-hover:text-white/25 transition-colors" />
      </div>
    </Link>
  );
}

// ─── WalletsRow (single-line floating cards) ────────────────────────

const WALLETS_VISIBLE = 4; // max visible in one row

function WalletsRow({ wallets, totalTxCount }: { wallets: WalletType[]; totalTxCount: number }) {
  const [expanded, setExpanded] = useState(false);
  const walletCount = wallets.length;
  const visible = expanded ? wallets : wallets.slice(0, WALLETS_VISIBLE);
  const overflow = walletCount - WALLETS_VISIBLE;

  return (
    <motion.div variants={fadeUp}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500/15 to-blue-500/5 flex items-center justify-center border border-blue-500/10">
            <Wallet className="w-4.5 h-4.5 text-blue-400" />
          </div>
          <div>
            <h2 className="font-display text-[15px] font-bold text-white">Wallets</h2>
            <p className="text-[11px] text-white/30">{walletCount} wallet{walletCount !== 1 ? 's' : ''} &middot; {totalTxCount.toLocaleString()} transactions</p>
          </div>
        </div>
        <Link
          href="/wallets"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-primary/70 hover:text-primary hover:bg-primary/5 transition-all font-medium"
        >
          Manage
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {!wallets.length ? (
        <div className="rounded-2xl bg-surface/60 backdrop-blur-md border border-white/[0.06] p-8 flex flex-col items-center gap-3 shadow-lg shadow-black/20">
          <Wallet className="w-8 h-8 text-white/10" />
          <p className="text-sm text-white/25">No wallets connected yet</p>
          <Link
            href="/wallets"
            className="flex items-center gap-1.5 text-xs text-primary font-medium hover:text-primary-400 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add your first wallet
          </Link>
        </div>
      ) : (
        <div className="flex items-stretch gap-3 overflow-hidden">
          {visible.map((wallet) => (
            <WalletChip key={wallet.id} wallet={wallet} />
          ))}

          {/* "+N more" button */}
          {overflow > 0 && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="shrink-0 flex items-center gap-2 px-5 rounded-2xl bg-surface/50 backdrop-blur-md border border-white/[0.06] hover:border-white/10 text-white/30 hover:text-white/60 transition-all shadow-lg shadow-black/20"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="text-sm font-semibold">{overflow} more</span>
            </button>
          )}
          {expanded && overflow > 0 && (
            <button
              onClick={() => setExpanded(false)}
              className="shrink-0 flex items-center gap-2 px-4 rounded-2xl bg-surface/50 backdrop-blur-md border border-white/[0.06] hover:border-white/10 text-white/20 hover:text-white/50 transition-all shadow-lg shadow-black/20"
            >
              <X className="w-3 h-3" />
              <span className="text-xs font-medium">Less</span>
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

function WalletChip({ wallet }: { wallet: WalletType }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const { data: syncStatus } = useQuery({
    queryKey: ['sync-status', wallet.id],
    queryFn: () => getSyncStatus(wallet.id),
    refetchInterval: (query) => {
      const data = query.state.data as SyncStatus | undefined;
      return data?.status === 'SYNCING' ? 3000 : 60000;
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => syncWallet(wallet.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sync-status', wallet.id] }),
  });

  const copyAddress = () => {
    navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const status = syncStatus?.status ?? 'IDLE';
  const isSyncing = status === 'SYNCING';

  const statusDot: Record<string, string> = {
    IDLE: 'bg-white/20',
    SYNCING: 'bg-primary animate-pulse',
    COMPLETED: 'bg-emerald-400',
    FAILED: 'bg-red-400',
    PAUSED: 'bg-amber-400',
  };

  const borderColor = isSyncing
    ? 'border-primary/20'
    : status === 'COMPLETED'
      ? 'border-emerald-500/10 hover:border-white/10'
      : 'border-white/[0.06] hover:border-white/10';

  return (
    <div
      className={`group relative flex-1 min-w-[200px] max-w-[340px] rounded-2xl bg-surface/70 backdrop-blur-md border ${borderColor} shadow-lg shadow-black/20 hover:shadow-xl hover:shadow-black/25 transition-all duration-200 overflow-hidden`}
    >
      {/* Syncing shimmer */}
      {isSyncing && <div className="absolute inset-0 shimmer pointer-events-none" />}

      {/* Top accent */}
      <div className={`h-[2px] w-full ${
        isSyncing
          ? 'bg-gradient-to-r from-primary/0 via-primary to-primary/0'
          : status === 'COMPLETED'
            ? 'bg-gradient-to-r from-emerald-500/0 via-emerald-500/30 to-emerald-500/0'
            : 'bg-gradient-to-r from-blue-500/0 via-blue-500/10 to-blue-500/0'
      }`} />

      <div className="px-4 py-3 flex items-center gap-3">
        {/* Icon with status dot */}
        <div className="relative shrink-0">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-colors ${
            isSyncing ? 'bg-primary/10 border-primary/15' : 'bg-white/[0.04] border-white/[0.04] group-hover:border-white/[0.08]'
          }`}>
            <Wallet className={`w-4 h-4 ${isSyncing ? 'text-primary' : 'text-blue-400/60'}`} />
          </div>
          <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface ${statusDot[status] ?? statusDot.IDLE}`} />
        </div>

        {/* Name + address */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-semibold text-white/85 truncate">{wallet.label || 'Wallet'}</p>
            {isSyncing && (
              <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[7px] font-bold bg-primary/10 text-primary uppercase tracking-wider animate-pulse">
                live
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] font-mono text-white/25">{truncateAddress(wallet.address, 4)}</span>
            <button onClick={copyAddress} className="text-white/10 hover:text-white/35 transition-colors">
              {copied ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
            </button>
          </div>
        </div>

        {/* Tx count + sync */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="px-2 py-1 rounded-lg bg-white/[0.04] text-[10px] font-mono text-white/30 border border-white/[0.03]">
            {wallet.transactionCount.toLocaleString()} tx
          </span>
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || isSyncing}
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all disabled:opacity-30 ${
              isSyncing ? 'bg-primary/10 text-primary' : 'bg-white/[0.03] text-white/15 hover:text-primary hover:bg-primary/10'
            }`}
            title="Sync"
          >
            {syncMutation.isPending || isSyncing ? (
              <Loader2 className="w-3 h-3 animate-spin text-primary" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>

      {/* Syncing progress bar */}
      {isSyncing && (
        <div className="px-4 pb-2">
          <div className="h-[2px] rounded-full bg-white/[0.04] overflow-hidden">
            <div className="h-full w-1/3 bg-gradient-to-r from-primary/80 to-primary rounded-full animate-indeterminate" />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AuditsPanel ────────────────────────────────────────────────────

function AuditsPanel({ audits }: { audits: Audit[] }) {
  const completed = audits.filter((a) => a.status === 'COMPLETED');
  const active = audits.filter((a) => ['QUEUED', 'PENDING', 'PROCESSING'].includes(a.status));
  const latestCompleted = completed[0];

  return (
    <div className="rounded-2xl bg-surface/60 backdrop-blur-md border border-white/[0.06] overflow-hidden shadow-lg shadow-black/20">
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 flex items-center justify-center border border-emerald-500/10">
            <Shield className="w-4.5 h-4.5 text-emerald-400" />
          </div>
          <div>
            <h2 className="font-display text-[15px] font-bold text-white">Audits</h2>
            <p className="text-[11px] text-white/25">{audits.length} audit{audits.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <Link
          href="/audits/new"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-[11px] font-semibold hover:bg-primary/20 transition-colors border border-primary/10"
        >
          <Plus className="w-3 h-3" />
          New
        </Link>
      </div>

      {audits.length === 0 ? (
        <div className="p-6 text-center">
          <FileSearch className="w-8 h-8 text-white/10 mx-auto mb-2" />
          <p className="text-xs text-white/25 mb-3">No audits yet</p>
          <Link
            href="/audits/new"
            className="inline-flex items-center gap-1.5 text-xs text-primary font-medium hover:text-primary-400 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Request your first audit
          </Link>
        </div>
      ) : (
        <div className="divide-y divide-white/[0.03]">
          {active.map((audit) => (
            <ActiveAuditRow key={audit.id} audit={audit} />
          ))}
          {latestCompleted && <CompletedAuditCard audit={latestCompleted} />}
          {completed.slice(1, 3).map((audit) => (
            <CompactAuditRow key={audit.id} audit={audit} />
          ))}
        </div>
      )}

      {audits.length > 0 && (
        <div className="px-5 py-3 border-t border-white/[0.03]">
          <Link
            href="/audits"
            className="flex items-center justify-center gap-1 text-[11px] text-primary/50 hover:text-primary transition-colors font-medium"
          >
            View all audits <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      )}
    </div>
  );
}

function ActiveAuditRow({ audit }: { audit: Audit }) {
  const flag = JURISDICTION_FLAGS[audit.jurisdiction] ?? audit.jurisdiction;
  return (
    <div className="px-5 py-3.5 flex items-center gap-3">
      <span className="text-lg">{flag}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white/60">{audit.jurisdiction} {audit.taxYear}</p>
        <p className="text-[10px] text-white/20">
          {audit.status === 'PROCESSING' ? 'Processing...' : audit.status === 'QUEUED' ? 'Queued' : 'Pending'}
        </p>
      </div>
      <Loader2 className="w-4 h-4 text-primary/50 animate-spin shrink-0" />
    </div>
  );
}

function CompletedAuditCard({ audit }: { audit: Audit }) {
  const flag = JURISDICTION_FLAGS[audit.jurisdiction] ?? audit.jurisdiction;
  const { data: result } = useQuery({
    queryKey: ['audit-result', audit.id],
    queryFn: () => getAuditResult(audit.id),
    staleTime: 5 * 60 * 1000,
  });
  const currency = result?.currency ?? 'USD';

  return (
    <Link href="/audits" className="block px-5 py-4 hover:bg-white/[0.02] transition-colors">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-lg">{flag}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-white/70">{audit.jurisdiction} Tax Audit</p>
            <span className="text-[10px] font-mono text-white/20">{audit.taxYear}</span>
          </div>
        </div>
        <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 text-[10px] font-semibold border border-emerald-500/10">
          <CheckCircle2 className="w-3 h-3" /> Done
        </span>
      </div>

      {result ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="px-3 py-2 rounded-lg bg-white/[0.025] border border-white/[0.04]">
            <p className="text-[9px] text-white/25 uppercase tracking-wider mb-0.5">Net Gain/Loss</p>
            <p className={`text-sm font-mono font-bold ${Number(result.netGainLoss) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {Number(result.netGainLoss) >= 0 ? '+' : ''}{formatCurrency(result.netGainLoss, currency)}
            </p>
          </div>
          <div className="px-3 py-2 rounded-lg bg-white/[0.025] border border-white/[0.04]">
            <p className="text-[9px] text-white/25 uppercase tracking-wider mb-0.5">Income</p>
            <p className="text-sm font-mono font-bold text-blue-400">{formatCurrency(result.totalIncome, currency)}</p>
          </div>
          <div className="px-3 py-2 rounded-lg bg-white/[0.025] border border-white/[0.04]">
            <p className="text-[9px] text-white/25 uppercase tracking-wider mb-0.5">Est. Tax</p>
            <p className="text-sm font-mono font-bold text-primary">{formatCurrency(result.estimatedTax, currency)}</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 py-2">
          <Loader2 className="w-3 h-3 text-white/15 animate-spin" />
          <span className="text-[11px] text-white/20">Loading results...</span>
        </div>
      )}
    </Link>
  );
}

function CompactAuditRow({ audit }: { audit: Audit }) {
  const flag = JURISDICTION_FLAGS[audit.jurisdiction] ?? audit.jurisdiction;
  return (
    <Link href="/audits" className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors">
      <span className="text-base">{flag}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-white/50">{audit.jurisdiction} {audit.taxYear}</p>
      </div>
      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/50" />
    </Link>
  );
}

// ─── TransactionRow ─────────────────────────────────────────────────

function getTxDirection(tx: Transaction): 'in' | 'out' | 'neutral' {
  switch (tx.type) {
    case 'TRANSFER_IN':
    case 'UNSTAKE':
      return 'in';
    case 'TRANSFER_OUT':
    case 'BURN':
    case 'STAKE':
      return 'out';
    case 'PROGRAM_INTERACTION':
      if (tx.summary?.startsWith('Received')) return 'in';
      if (tx.summary?.startsWith('Sent')) return 'out';
      return 'neutral';
    default:
      return 'neutral';
  }
}

function getTxFlowLabel(tx: Transaction): string | null {
  if (!tx.transfers?.length) return null;
  if (tx.type === 'SWAP' && tx.transfers.length >= 2) {
    const out = tx.transfers.find((t) => t.direction === 'OUT');
    const inn = tx.transfers.find((t) => t.direction === 'IN');
    if (out && inn) return `${out.token?.symbol ?? '?'} \u2192 ${inn.token?.symbol ?? '?'}`;
  }
  return null;
}

function TransactionRow({
  tx,
  walletInfo,
}: {
  tx: Transaction;
  walletInfo?: { label: string | null; address: string };
}) {
  const config = TX_TYPE_CONFIG[tx.type] ?? TX_TYPE_CONFIG.UNKNOWN;
  const Icon = config.icon;
  const d = new Date(tx.timestamp);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const walletDisplay = walletInfo?.label || (walletInfo?.address ? truncateAddress(walletInfo.address) : '—');
  const protocol = tx.enrichment?.protocolName;
  const direction = getTxDirection(tx);
  const flowLabel = getTxFlowLabel(tx);
  const valueColor = direction === 'in' ? 'text-emerald-400' : direction === 'out' ? 'text-orange-400' : 'text-white/50';
  const valuePrefix = direction === 'in' ? '+' : direction === 'out' ? '-' : '';

  return (
    <div className="group grid grid-cols-1 md:grid-cols-[1fr_120px_100px_120px_70px] gap-2 md:gap-3 items-center px-5 py-3 hover:bg-white/[0.02] transition-colors">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0 group-hover:bg-white/[0.06] transition-colors">
          <Icon className={`w-3.5 h-3.5 ${config.color}`} />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-white/70 truncate">{tx.summary || config.label}</p>
          <div className="flex items-center gap-1.5">
            <span className={`text-[10px] font-medium ${config.color}`}>{config.label}</span>
            {flowLabel && (
              <>
                <span className="text-white/10">&middot;</span>
                <span className="text-[10px] text-white/20">{flowLabel}</span>
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
      </div>

      <div className="hidden md:block">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/[0.03] text-[10px] font-mono text-white/30 truncate max-w-full">
          <Wallet className="w-2.5 h-2.5 text-white/15 shrink-0" />
          {walletDisplay}
        </span>
      </div>

      <div className="hidden md:block">
        <p className="text-xs text-white/40">{date}</p>
        <p className="text-[10px] text-white/15">{time}</p>
      </div>

      <div className="hidden md:block text-right">
        {tx.totalValueUsd != null ? (
          <p className={`text-xs font-mono font-medium ${valueColor}`}>
            {valuePrefix}${tx.totalValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        ) : (
          <p className="text-xs font-mono text-white/15">&mdash;</p>
        )}
      </div>

      <div className="hidden md:flex items-center justify-end gap-1">
        <span className={`w-1.5 h-1.5 rounded-full ${tx.status === 'CONFIRMED' ? 'bg-emerald-400' : 'bg-red-400'}`} />
        <span className="text-[10px] text-white/25 capitalize">{tx.status.toLowerCase()}</span>
      </div>
    </div>
  );
}

// ─── ExchangePanel ──────────────────────────────────────────────────

const EXCHANGE_STATUS_CONFIG: Record<ExchangeConnection['status'], { color: string; bg: string; label: string }> = {
  ACTIVE: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Active' },
  INACTIVE: { color: 'text-white/30', bg: 'bg-white/5', label: 'Inactive' },
  ERROR: { color: 'text-red-400', bg: 'bg-red-500/10', label: 'Error' },
  REVOKED: { color: 'text-white/20', bg: 'bg-white/5', label: 'Revoked' },
};

function ExchangePanel({
  connections,
  onConnect,
}: {
  connections: ExchangeConnection[];
  onConnect: () => void;
}) {
  const queryClient = useQueryClient();

  const syncMutation = useMutation({
    mutationFn: (id: string) => syncExchangeConnection(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exchange-connections'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteExchangeConnection(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exchange-connections'] }),
  });

  return (
    <div className="rounded-2xl bg-surface/60 backdrop-blur-md border border-white/[0.06] overflow-hidden shadow-lg shadow-black/20">
      <div className="px-5 py-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500/15 to-violet-500/5 flex items-center justify-center border border-violet-500/10">
            <Link2 className="w-4.5 h-4.5 text-violet-400" />
          </div>
          <div className="flex-1">
            <h2 className="font-display text-[15px] font-bold text-white">Exchanges</h2>
            <p className="text-[11px] text-white/25">Linked exchange accounts</p>
          </div>
          {connections.length > 0 && (
            <span className="text-[10px] font-mono text-white/15 bg-white/[0.03] px-2 py-0.5 rounded">{connections.length}</span>
          )}
        </div>
      </div>

      {connections.length === 0 ? (
        <div className="p-6 text-center">
          <Link2 className="w-8 h-8 text-white/10 mx-auto mb-2" />
          <p className="text-xs text-white/25 mb-1">No exchanges connected</p>
          <p className="text-[10px] text-white/15 mb-3">Import trade history from exchanges</p>
        </div>
      ) : (
        <div className="divide-y divide-white/[0.03]">
          {connections.map((conn) => {
            const statusCfg = EXCHANGE_STATUS_CONFIG[conn.status];
            return (
              <div key={conn.id} className="px-5 py-3.5 hover:bg-white/[0.015] transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0">
                    <Link2 className="w-3.5 h-3.5 text-white/25" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white/70 capitalize">{conn.exchangeName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium ${statusCfg.bg} ${statusCfg.color}`}>
                        {statusCfg.label}
                      </span>
                      {conn.lastSyncAt && (
                        <span className="text-[9px] text-white/15">
                          Synced {new Date(conn.lastSyncAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => syncMutation.mutate(conn.id)}
                      disabled={syncMutation.isPending}
                      className="w-6 h-6 rounded-md bg-white/[0.03] flex items-center justify-center text-white/15 hover:text-primary hover:bg-primary/10 transition-all"
                    >
                      {syncMutation.isPending ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate(conn.id)}
                      disabled={deleteMutation.isPending}
                      className="w-6 h-6 rounded-md bg-white/[0.03] flex items-center justify-center text-white/15 hover:text-red-400 hover:bg-red-500/10 transition-all"
                    >
                      {deleteMutation.isPending ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Trash2 className="w-2.5 h-2.5" />}
                    </button>
                  </div>
                </div>
                {conn.lastError && (
                  <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-1.5">
                    <AlertTriangle className="w-2.5 h-2.5 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-[9px] text-red-400/60 leading-relaxed">{conn.lastError}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="px-4 pb-4 pt-2">
        <button
          onClick={onConnect}
          className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors border border-primary/10"
        >
          <Plus className="w-3.5 h-3.5" />
          Connect Exchange
        </button>
      </div>
    </div>
  );
}

// ─── ConnectExchangeModal ───────────────────────────────────────────

function ConnectExchangeModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'select' | 'credentials'>('select');
  const [selectedExchange, setSelectedExchange] = useState<AvailableExchange | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [subAccount, setSubAccount] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState('');

  const { data: availableExchanges, isLoading } = useQuery({
    queryKey: ['available-exchanges'],
    queryFn: getAvailableExchanges,
  });

  const needsPassphrase = selectedExchange?.requiredCredentials?.includes('passphrase');

  const linkMutation = useMutation({
    mutationFn: () =>
      linkExchange({
        exchangeName: selectedExchange!.id,
        apiKey,
        apiSecret,
        subAccountLabel: subAccount || undefined,
        passphrase: passphrase || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchange-connections'] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const handleSelectExchange = (exchange: AvailableExchange) => {
    setSelectedExchange(exchange);
    setStep('credentials');
    setError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!apiKey.trim()) { setError('API Key is required'); return; }
    if (!apiSecret.trim()) { setError('API Secret is required'); return; }
    if (needsPassphrase && !passphrase.trim()) { setError('Passphrase is required for this exchange'); return; }
    linkMutation.mutate();
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full max-w-lg bg-surface border border-white/[0.06] rounded-2xl overflow-hidden shadow-2xl shadow-black/40">
          <div className="px-6 py-5 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-3">
              {step === 'credentials' && (
                <button
                  onClick={() => { setStep('select'); setError(''); }}
                  className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white/30 hover:text-white hover:bg-white/10 transition-all mr-1"
                >
                  <ArrowRight className="w-4 h-4 rotate-180" />
                </button>
              )}
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/10">
                <Link2 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-white">
                  {step === 'select' ? 'Connect Exchange' : selectedExchange?.name}
                </h2>
                <p className="text-xs text-white/30">
                  {step === 'select' ? 'Select an exchange to link' : 'Enter your API credentials'}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white/30 hover:text-white hover:bg-white/10 transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {step === 'select' && (
            <div className="p-6">
              {isLoading ? (
                <div className="py-8 flex flex-col items-center gap-3">
                  <Loader2 className="w-5 h-5 text-primary/50 animate-spin" />
                  <p className="text-sm text-white/30">Loading exchanges...</p>
                </div>
              ) : !availableExchanges?.length ? (
                <div className="py-8 flex flex-col items-center gap-3">
                  <Link2 className="w-6 h-6 text-white/10" />
                  <p className="text-sm text-white/30">No exchanges available</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {availableExchanges.map((exchange) => (
                    <button
                      key={exchange.id}
                      onClick={() => handleSelectExchange(exchange)}
                      className="w-full flex items-center gap-4 p-4 rounded-xl border border-white/5 hover:border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition-all text-left group"
                    >
                      <div className="w-11 h-11 rounded-xl bg-white/5 flex items-center justify-center shrink-0 overflow-hidden">
                        {exchange.logo ? (
                          <img
                            src={exchange.logo}
                            alt={exchange.name}
                            className="w-7 h-7 object-contain"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <Link2 className="w-5 h-5 text-white/20" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white/80 group-hover:text-white transition-colors">
                          {exchange.name}
                        </p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {exchange.features.map((feat) => (
                            <span key={feat} className="px-2 py-0.5 rounded text-[10px] bg-white/5 text-white/25 capitalize">
                              {feat}
                            </span>
                          ))}
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-white/10 group-hover:text-white/30 transition-colors shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 'credentials' && selectedExchange && (
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {selectedExchange.notes && (
                <div className="px-4 py-3 rounded-xl bg-primary/5 border border-primary/10 flex items-start gap-2.5">
                  <Shield className="w-4 h-4 text-primary/60 shrink-0 mt-0.5" />
                  <p className="text-xs text-white/40 leading-relaxed">{selectedExchange.notes}</p>
                </div>
              )}

              <div>
                <label className="block text-xs text-white/40 mb-2 uppercase tracking-wider font-medium">API Key</label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2"><Key className="w-4 h-4 text-white/15" /></div>
                  <input
                    type="text"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Enter your API key..."
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/[0.04] border border-white/5 text-sm text-white/80 font-mono placeholder-white/20 focus:outline-none focus:border-primary/30 focus:bg-white/[0.06] transition-all"
                    autoComplete="off"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-white/40 mb-2 uppercase tracking-wider font-medium">API Secret</label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2"><Key className="w-4 h-4 text-white/15" /></div>
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                    placeholder="Enter your API secret..."
                    className="w-full pl-10 pr-12 py-3 rounded-xl bg-white/[0.04] border border-white/5 text-sm text-white/80 font-mono placeholder-white/20 focus:outline-none focus:border-primary/30 focus:bg-white/[0.06] transition-all"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/40 transition-colors"
                  >
                    {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {needsPassphrase && (
                <div>
                  <label className="block text-xs text-white/40 mb-2 uppercase tracking-wider font-medium">Passphrase</label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2"><Key className="w-4 h-4 text-white/15" /></div>
                    <input
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="Enter your API passphrase..."
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/[0.04] border border-white/5 text-sm text-white/80 font-mono placeholder-white/20 focus:outline-none focus:border-primary/30 focus:bg-white/[0.06] transition-all"
                      autoComplete="off"
                    />
                  </div>
                </div>
              )}

              {selectedExchange.optionalCredentials?.includes('subAccountLabel') && (
                <div>
                  <label className="block text-xs text-white/40 mb-2 uppercase tracking-wider font-medium">
                    Sub-Account <span className="text-white/15">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={subAccount}
                    onChange={(e) => setSubAccount(e.target.value)}
                    placeholder="e.g. Trading, Spot..."
                    className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/5 text-sm text-white/80 placeholder-white/20 focus:outline-none focus:border-primary/30 focus:bg-white/[0.06] transition-all"
                  />
                </div>
              )}

              {selectedExchange.docs && (
                <a
                  href={selectedExchange.docs}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-primary/60 hover:text-primary transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  How to create API keys on {selectedExchange.name}
                </a>
              )}

              {error && (
                <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-3 rounded-xl bg-white/5 text-sm text-white/50 font-medium hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={linkMutation.isPending}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-background text-sm font-semibold hover:bg-primary-400 transition-all disabled:opacity-50"
                >
                  {linkMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                  Connect
                </button>
              </div>
            </form>
          )}
        </div>
      </motion.div>
    </>
  );
}
