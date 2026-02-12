'use client';

import { useState } from 'react';
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
  Hexagon,
  ChevronDown,
  Download,
  Send,
  ArrowLeftRight,
  ArrowDownRight,
  ArrowUpRight,
  Coins,
  Calendar,
  MoreHorizontal,
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
  XCircle,
  Trash2,
  X,
  ExternalLink,
  Eye,
  EyeOff,
  Key,
} from 'lucide-react';
import { Navbar } from '@/components/dashboard/Sidebar';
import { TaxObligations } from '@/components/dashboard/TaxObligations';
import { ChatWidget } from '@/components/dashboard/ChatWidget';
import { JURISDICTIONS } from '@/lib/constants';
import {
  listWallets,
  getTransactionStats,
  queryTransactions,
  listExchangeConnections,
  getAvailableExchanges,
  linkExchange,
  syncExchangeConnection,
  deleteExchangeConnection,
  type Transaction,
  type ExchangeConnection,
  type AvailableExchange,
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
    transition: { duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

// ─── Transaction type config ─────────────────────────────────────────

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

const TX_STATUS_DOT: Record<Transaction['status'], string> = {
  CONFIRMED: 'bg-emerald-400',
  FAILED: 'bg-red-400',
};

function formatTxDate(timestamp: string): { date: string; time: string } {
  const d = new Date(timestamp);
  return {
    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
  };
}

function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

// ─── Mini sparkline paths ────────────────────────────────────────────

const SPARKLINE_UP = 'M0,32 L8,28 L16,30 L24,22 L32,24 L40,16 L48,18 L56,10 L64,12 L72,4';
const SPARKLINE_DOWN = 'M0,8 L8,12 L16,10 L24,18 L32,16 L40,24 L48,22 L56,28 L64,26 L72,32';
const SPARKLINE_FLAT = 'M0,18 L8,16 L16,20 L24,14 L32,18 L40,16 L48,20 L56,14 L64,18 L72,16';

// ─── Main Dashboard ──────────────────────────────────────────────────

export default function Dashboard() {
  const { connected, publicKey } = useWallet();
  const [showConnectExchange, setShowConnectExchange] = useState(false);

  useEffect(() => {
    if (!connected) {
      redirect('/');
    }
  }, [connected]);

  if (!connected || !publicKey) {
    return null;
  }

  const walletAddress = publicKey.toBase58();
  const truncatedAddress = `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;
  const activeJurisdictions = JURISDICTIONS.filter((j) => j.active);

  // Real data from API
  const { data: wallets } = useQuery({
    queryKey: ['wallets'],
    queryFn: listWallets,
    retry: 1,
  });

  const { data: txStats } = useQuery({
    queryKey: ['transaction-stats'],
    queryFn: () => getTransactionStats(),
    retry: 1,
  });

  const { data: recentTxs, isLoading: txsLoading } = useQuery({
    queryKey: ['recent-transactions'],
    queryFn: () => queryTransactions({ take: 10, excludeTypes: ['UNKNOWN'] }),
    retry: 1,
  });

  const { data: exchangeConnections } = useQuery({
    queryKey: ['exchange-connections'],
    queryFn: listExchangeConnections,
    retry: 1,
  });

  const walletCount = wallets?.length ?? 0;
  const totalTxCount = wallets?.reduce((sum, w) => sum + w.transactionCount, 0) ?? 0;
  const exchangeCount = exchangeConnections?.length ?? 0;

  // Build wallet lookup: walletId → { label, address }
  const walletMap = new Map<string, { label: string | null; address: string }>();
  wallets?.forEach((w) => walletMap.set(w.id, { label: w.label, address: w.address }));

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
          className="max-w-[1600px] mx-auto"
        >
          {/* ─── Hero Banner ──────────────────────────────── */}
          <motion.div variants={fadeUp}>
            <div className="relative overflow-hidden mx-5 lg:mx-8 mt-6 rounded-2xl">
              {/* Gradient background */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary-800 via-primary-700/80 to-primary-900" />
              <div className="absolute inset-0 bg-gradient-to-r from-primary/20 via-transparent to-primary-600/10" />
              <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/4" />
              <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-primary-400/10 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/4" />
              {/* Honeycomb overlay */}
              <div className="absolute inset-0 honeycomb-bg opacity-40" />

              <div className="relative px-6 lg:px-10 py-8 lg:py-10">
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
                  {/* Left: Balance */}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm text-white/50 font-medium">
                        {walletCount > 1 ? `${walletCount} Wallets` : 'Portfolio Balance'}
                      </p>
                      <span className="text-white/20">|</span>
                      <button className="flex items-center gap-1 text-xs font-mono text-white/40 hover:text-white/60 transition-colors">
                        {truncatedAddress}
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="flex items-baseline gap-3 mb-1">
                      <h2 className="font-display text-5xl lg:text-6xl font-extrabold text-white tracking-tight">
                        {totalTxCount.toLocaleString()}
                      </h2>
                      <span className="text-2xl lg:text-3xl font-display font-bold text-white/50">transactions</span>
                    </div>
                    <p className="text-sm text-white/30 mb-4">
                      {totalTxCount > 0
                        ? `Indexed across ${walletCount} wallet${walletCount > 1 ? 's' : ''}`
                        : 'Connect wallets and sync to start indexing'}
                    </p>
                    <div className="flex items-center gap-4">
                      <Link
                        href="/audits/new"
                        className="group inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/10 backdrop-blur-sm text-white text-sm font-semibold hover:bg-white/20 transition-all border border-white/10"
                      >
                        <Shield className="w-4 h-4" />
                        Request Audit
                      </Link>
                      <Link
                        href="/wallets"
                        className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition-colors font-medium"
                      >
                        <Wallet className="w-4 h-4" />
                        Manage Wallets
                      </Link>
                      <button className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/10 transition-all">
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Right: Date + Export */}
                  <div className="flex items-center gap-3">
                    <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 text-sm text-white/60 hover:text-white/80 hover:bg-white/10 transition-all">
                      <Calendar className="w-4 h-4" />
                      <span>Jan 2025 - Tax Year</span>
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                    <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 backdrop-blur-sm border border-white/10 text-sm text-white font-medium hover:bg-white/20 transition-all">
                      <Download className="w-4 h-4" />
                      Export
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ─── Stat Cards Row ───────────────────────────── */}
          <div className="px-5 lg:px-8 mt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <motion.div variants={fadeUp}>
                <FinanceCard
                  icon={Wallet}
                  label="Connected Wallets"
                  value={String(walletCount || 1)}
                  change={walletCount ? `${walletCount} wallet${walletCount > 1 ? 's' : ''} active` : 'Add more wallets'}
                  trend={walletCount ? 'up' : 'neutral'}
                  sparkline={SPARKLINE_FLAT}
                />
              </motion.div>
              <motion.div variants={fadeUp}>
                <FinanceCard
                  icon={Activity}
                  label="Transactions Indexed"
                  value={totalTxCount ? totalTxCount.toLocaleString() : '0'}
                  change={totalTxCount ? `Across ${walletCount} wallet${walletCount > 1 ? 's' : ''}` : 'Awaiting sync'}
                  trend={totalTxCount > 0 ? 'up' : 'neutral'}
                  sparkline={SPARKLINE_UP}
                />
              </motion.div>
              <motion.div variants={fadeUp}>
                <FinanceCard
                  icon={Coins}
                  label="Estimated Tax Liability"
                  value={txStats?.totalValueUsd ? `$${txStats.totalValueUsd.toLocaleString()}` : '—'}
                  change={txStats ? 'Run audit for full report' : 'Pending calculation'}
                  trend="neutral"
                  sparkline={SPARKLINE_DOWN}
                />
              </motion.div>
              <motion.div variants={fadeUp}>
                <FinanceCard
                  icon={Link2}
                  label="Exchange Connections"
                  value={String(exchangeCount)}
                  change={exchangeCount ? `${exchangeCount} exchange${exchangeCount > 1 ? 's' : ''} linked` : 'Connect an exchange'}
                  trend={exchangeCount > 0 ? 'up' : 'neutral'}
                  sparkline={SPARKLINE_FLAT}
                />
              </motion.div>
            </div>
          </div>

          {/* ─── Main Content: Table + Side panels ────────── */}
          <div className="px-5 lg:px-8 mt-6 pb-10">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              {/* Recent Transactions - 2 cols */}
              <motion.div variants={fadeUp} className="xl:col-span-2">
                <div className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 overflow-hidden">
                  <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                    <h2 className="font-display text-lg font-bold text-white">Recent Activity</h2>
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-xs text-white/50 hover:text-white/70 transition-colors">
                      Week
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Table header */}
                  <div className="hidden md:grid grid-cols-[1fr_130px_110px_130px_80px] gap-4 px-6 py-3 border-b border-white/5">
                    <span className="text-[11px] font-medium text-white/20 uppercase tracking-wider">Type</span>
                    <span className="text-[11px] font-medium text-white/20 uppercase tracking-wider">Wallet</span>
                    <span className="text-[11px] font-medium text-white/20 uppercase tracking-wider">Date</span>
                    <span className="text-[11px] font-medium text-white/20 uppercase tracking-wider text-right">Value</span>
                    <span className="text-[11px] font-medium text-white/20 uppercase tracking-wider text-right">Status</span>
                  </div>

                  {/* Transaction rows */}
                  <div className="divide-y divide-white/[0.03]">
                    {txsLoading ? (
                      <div className="px-6 py-12 flex flex-col items-center gap-3">
                        <RefreshCw className="w-5 h-5 text-white/15 animate-spin" />
                        <p className="text-xs text-white/20">Loading transactions...</p>
                      </div>
                    ) : !recentTxs || recentTxs.length === 0 ? (
                      <div className="px-6 py-12 flex flex-col items-center gap-3">
                        <Activity className="w-6 h-6 text-white/10" />
                        <p className="text-sm text-white/25">No transactions yet</p>
                        <p className="text-xs text-white/15">Add and sync a wallet to see activity here</p>
                      </div>
                    ) : (
                      recentTxs.map((tx) => (
                        <TransactionRow
                          key={tx.id}
                          tx={tx}
                          walletInfo={walletMap.get(tx.walletId)}
                        />
                      ))
                    )}
                  </div>

                  {/* Footer */}
                  <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between">
                    <p className="text-xs text-white/20">
                      {recentTxs?.length
                        ? `Showing ${recentTxs.length} of ${totalTxCount.toLocaleString()} transactions`
                        : 'No transactions to show'}
                    </p>
                    <Link
                      href="/audits"
                      className="text-xs text-primary/70 hover:text-primary flex items-center gap-1 transition-colors font-medium"
                    >
                      View all transactions
                      <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              </motion.div>

              {/* Right column: Exchanges + Tax Obligations + Swarm Agents */}
              <motion.div variants={fadeUp} className="space-y-6">
                {/* Exchange Connections */}
                <ExchangePanel
                  connections={exchangeConnections ?? []}
                  onConnect={() => setShowConnectExchange(true)}
                />

                <TaxObligations jurisdictions={activeJurisdictions} />

                <div className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 overflow-hidden flex flex-col">
                  <div className="px-6 py-5 border-b border-white/5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Hexagon className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h2 className="font-display text-lg font-bold text-white">Swarm Agents</h2>
                        <p className="text-xs text-white/30">AI-powered compliance bees</p>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 space-y-2 flex-1">
                    {activeJurisdictions.map((j) => (
                      <SwarmAgent
                        key={j.code}
                        name={`${j.code} Bee`}
                        flag={j.flag}
                        jurisdiction={j.name}
                        status="idle"
                      />
                    ))}
                  </div>

                  <div className="px-4 pb-4">
                    <Link
                      href="/audits/new"
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      Activate Swarm
                    </Link>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>

          {/* Chat Widget */}
          <ChatWidget />
        </motion.main>
      </div>

      {/* Connect Exchange Modal */}
      <AnimatePresence>
        {showConnectExchange && (
          <ConnectExchangeModal onClose={() => setShowConnectExchange(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── FinanceCard (stat card with sparkline) ──────────────────────────

function FinanceCard({
  icon: Icon,
  label,
  value,
  change,
  trend,
  sparkline,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  change: string;
  trend: 'up' | 'down' | 'neutral';
  sparkline: string;
}) {
  const trendColor =
    trend === 'up'
      ? 'text-emerald-400'
      : trend === 'down'
        ? 'text-red-400'
        : 'text-white/25';
  const strokeColor =
    trend === 'up'
      ? '#34D399'
      : trend === 'down'
        ? '#F87171'
        : 'rgba(255,255,255,0.15)';

  return (
    <div className="group relative rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 p-5 hover:border-white/10 transition-all duration-300 overflow-hidden">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center">
            <Icon className="w-4.5 h-4.5 text-white/40" />
          </div>
          <span className="text-sm text-white/40 font-medium">{label}</span>
        </div>
        <button className="text-white/10 hover:text-white/30 transition-colors">
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <span className="font-display text-3xl font-bold text-white tracking-tight">{value}</span>
          <div className="flex items-center gap-1 mt-1">
            {trend === 'up' && <TrendingUp className={`w-3 h-3 ${trendColor}`} />}
            {trend === 'down' && <TrendingDown className={`w-3 h-3 ${trendColor}`} />}
            <span className={`text-xs ${trendColor}`}>{change}</span>
          </div>
        </div>

        {/* Mini sparkline */}
        <svg width="72" height="36" viewBox="0 0 72 36" className="opacity-60 group-hover:opacity-100 transition-opacity">
          <path
            d={sparkline}
            fill="none"
            stroke={strokeColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

// ─── TransactionRow ──────────────────────────────────────────────────

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
      // Derive direction from summary (set by API based on accountData/transfers)
      if (tx.summary?.startsWith('Received')) return 'in';
      if (tx.summary?.startsWith('Sent')) return 'out';
      return 'neutral';
    }
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
  const { date, time } = formatTxDate(tx.timestamp);
  const walletDisplay = walletInfo?.label || (walletInfo?.address ? truncateAddress(walletInfo.address) : '—');
  const protocol = tx.enrichment?.protocolName;
  const direction = getTxDirection(tx);
  const flowLabel = getTxFlowLabel(tx);

  const valueColor =
    direction === 'in' ? 'text-emerald-400' : direction === 'out' ? 'text-orange-400' : 'text-white/60';
  const valuePrefix = direction === 'in' ? '+' : direction === 'out' ? '-' : '';

  return (
    <div className="group grid grid-cols-1 md:grid-cols-[1fr_130px_110px_130px_80px] gap-2 md:gap-4 items-center px-6 py-4 hover:bg-white/[0.02] transition-colors">
      {/* Type + summary */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0 group-hover:bg-white/[0.08] transition-colors">
          <Icon className={`w-4 h-4 ${config.color}`} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-white/80 truncate">{tx.summary || config.label}</p>
          <div className="flex items-center gap-1.5">
            <span className={`text-[11px] font-medium ${config.color}`}>{config.label}</span>
            {flowLabel && (
              <>
                <span className="text-white/10">&middot;</span>
                <span className="text-[11px] text-white/25">{flowLabel}</span>
              </>
            )}
            {!flowLabel && protocol && (
              <>
                <span className="text-white/10">&middot;</span>
                <span className="text-[11px] text-white/25">{protocol}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Wallet */}
      <div className="hidden md:block">
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.04] text-[11px] font-mono text-white/40 truncate max-w-full">
          <Wallet className="w-3 h-3 text-white/20 shrink-0" />
          {walletDisplay}
        </span>
      </div>

      {/* Date */}
      <div className="hidden md:block">
        <p className="text-sm text-white/50">{date}</p>
        <p className="text-[11px] text-white/20">{time}</p>
      </div>

      {/* Value */}
      <div className="hidden md:block text-right">
        {tx.totalValueUsd != null ? (
          <p className={`text-sm font-mono font-medium ${valueColor}`}>
            {valuePrefix}${tx.totalValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        ) : (
          <p className="text-sm font-mono text-white/20">&mdash;</p>
        )}
        <p className="text-[11px] font-mono text-white/20">
          Fee: {Number(tx.fee).toLocaleString()} lamports
        </p>
      </div>

      {/* Status */}
      <div className="hidden md:flex items-center justify-end gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${TX_STATUS_DOT[tx.status]}`} />
        <span className="text-[11px] text-white/30 capitalize">{tx.status.toLowerCase()}</span>
      </div>
    </div>
  );
}

// ─── SwarmAgent ──────────────────────────────────────────────────────

function SwarmAgent({
  name,
  flag,
  jurisdiction,
  status,
}: {
  name: string;
  flag: string;
  jurisdiction: string;
  status: 'idle' | 'working' | 'complete';
}) {
  const statusStyles = {
    idle: { dot: 'bg-white/20', label: 'Idle', text: 'text-white/30' },
    working: { dot: 'bg-primary animate-pulse', label: 'Working', text: 'text-primary' },
    complete: { dot: 'bg-emerald-400', label: 'Complete', text: 'text-emerald-400' },
  };

  const config = statusStyles[status];

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.02] transition-colors">
      <span className="text-lg">{flag}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white/60">{name}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
        <span className={`text-[11px] font-medium ${config.text}`}>{config.label}</span>
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
    <div className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 overflow-hidden">
      <div className="px-6 py-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Link2 className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="font-display text-lg font-bold text-white">Exchanges</h2>
            <p className="text-xs text-white/30">Linked exchange accounts</p>
          </div>
          {connections.length > 0 && (
            <span className="text-xs font-mono text-white/20">{connections.length}</span>
          )}
        </div>
      </div>

      {connections.length === 0 ? (
        <div className="p-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-3">
            <Link2 className="w-6 h-6 text-white/10" />
          </div>
          <p className="text-sm text-white/30 mb-1">No exchanges connected</p>
          <p className="text-xs text-white/15 mb-4">
            Link Binance, Coinbase, or other exchanges to import trade history.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-white/[0.03]">
          {connections.map((conn) => {
            const statusCfg = EXCHANGE_STATUS_CONFIG[conn.status];
            return (
              <div key={conn.id} className="px-5 py-4 hover:bg-white/[0.015] transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                    <Link2 className="w-4 h-4 text-white/25" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white/70 capitalize">{conn.exchangeName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${statusCfg.bg} ${statusCfg.color}`}>
                        {statusCfg.label}
                      </span>
                      {conn.lastSyncAt && (
                        <span className="text-[10px] text-white/15">
                          Synced {new Date(conn.lastSyncAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => syncMutation.mutate(conn.id)}
                      disabled={syncMutation.isPending}
                      className="w-7 h-7 rounded-lg bg-white/[0.03] flex items-center justify-center text-white/15 hover:text-primary hover:bg-primary/10 transition-all"
                      title="Sync"
                    >
                      {syncMutation.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3" />
                      )}
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate(conn.id)}
                      disabled={deleteMutation.isPending}
                      className="w-7 h-7 rounded-lg bg-white/[0.03] flex items-center justify-center text-white/15 hover:text-red-400 hover:bg-red-500/10 transition-all"
                      title="Disconnect"
                    >
                      {deleteMutation.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Trash2 className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>
                {conn.lastError && (
                  <div className="mt-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
                    <AlertTriangle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-red-400/70 leading-relaxed">{conn.lastError}</p>
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
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
        >
          <Plus className="w-4 h-4" />
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
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSelectExchange = (exchange: AvailableExchange) => {
    setSelectedExchange(exchange);
    setStep('credentials');
    setError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!apiKey.trim()) {
      setError('API Key is required');
      return;
    }
    if (!apiSecret.trim()) {
      setError('API Secret is required');
      return;
    }
    if (needsPassphrase && !passphrase.trim()) {
      setError('Passphrase is required for this exchange');
      return;
    }

    linkMutation.mutate();
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
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
        <div className="w-full max-w-lg bg-surface border border-white/5 rounded-2xl overflow-hidden shadow-2xl">
          {/* Header */}
          <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {step === 'credentials' && (
                <button
                  onClick={() => { setStep('select'); setError(''); }}
                  className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white/30 hover:text-white hover:bg-white/10 transition-all mr-1"
                >
                  <ArrowRight className="w-4 h-4 rotate-180" />
                </button>
              )}
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
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

          {/* Step 1: Exchange selection */}
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
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              (e.target as HTMLImageElement).parentElement!.innerHTML = '<svg class="w-5 h-5 text-white/20" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
                            }}
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
                            <span
                              key={feat}
                              className="px-2 py-0.5 rounded text-[10px] bg-white/5 text-white/25 capitalize"
                            >
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

          {/* Step 2: Credentials form */}
          {step === 'credentials' && selectedExchange && (
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Info banner */}
              {selectedExchange.notes && (
                <div className="px-4 py-3 rounded-xl bg-primary/5 border border-primary/10 flex items-start gap-2.5">
                  <Shield className="w-4 h-4 text-primary/60 shrink-0 mt-0.5" />
                  <p className="text-xs text-white/40 leading-relaxed">{selectedExchange.notes}</p>
                </div>
              )}

              {/* API Key */}
              <div>
                <label className="block text-xs text-white/40 mb-2 uppercase tracking-wider font-medium">
                  API Key
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2">
                    <Key className="w-4 h-4 text-white/15" />
                  </div>
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

              {/* API Secret */}
              <div>
                <label className="block text-xs text-white/40 mb-2 uppercase tracking-wider font-medium">
                  API Secret
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2">
                    <Key className="w-4 h-4 text-white/15" />
                  </div>
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

              {/* Passphrase (required for OKX) */}
              {needsPassphrase && (
                <div>
                  <label className="block text-xs text-white/40 mb-2 uppercase tracking-wider font-medium">
                    Passphrase
                  </label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2">
                      <Key className="w-4 h-4 text-white/15" />
                    </div>
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

              {/* Sub-account (optional) */}
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

              {/* Docs link */}
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

              {/* Error */}
              {error && (
                <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              )}

              {/* Actions */}
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
                  {linkMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Link2 className="w-4 h-4" />
                  )}
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
