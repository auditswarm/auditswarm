'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileSearch,
  Plus,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  DollarSign,
  BarChart3,
  AlertCircle,
  X,
  Receipt,
  Wallet,
  Shield,
  ShieldCheck,
  ShieldX,
  ShieldAlert,
  Lightbulb,
  ExternalLink,
  Ban,
} from 'lucide-react';
import { Navbar } from '@/components/dashboard/Sidebar';
import {
  listAudits,
  getAuditResult,
  createAttestation,
  getAttestation,
  revokeAttestation,
  getWalletAttestations,
  type Audit,
  type AuditStatus,
  type AuditResult,
  type Attestation,
  type MonthlyBreakdown,
} from '@/lib/api';

const container = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.08 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] } },
};

const JURISDICTION_FLAGS: Record<string, string> = {
  US: '\u{1F1FA}\u{1F1F8}',
  EU: '\u{1F1EA}\u{1F1FA}',
  BR: '\u{1F1E7}\u{1F1F7}',
};

type FilterTab = 'ALL' | AuditStatus;

const STATUS_CONFIG: Record<AuditStatus, { icon: typeof Clock; label: string; color: string; bg: string }> = {
  QUEUED: { icon: Clock, label: 'Queued', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  PENDING: { icon: Clock, label: 'Pending', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  PROCESSING: { icon: Loader2, label: 'Processing', color: 'text-blue-400', bg: 'bg-blue-500/10' },
  COMPLETED: { icon: CheckCircle2, label: 'Completed', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  FAILED: { icon: XCircle, label: 'Failed', color: 'text-red-400', bg: 'bg-red-500/10' },
  CANCELLED: { icon: XCircle, label: 'Cancelled', color: 'text-white/30', bg: 'bg-white/5' },
};

const FILTER_TABS: { value: FilterTab; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'FAILED', label: 'Failed' },
];

type AuditModalTab = 'overview' | 'transactions' | 'holdings';

const MODAL_TABS: { value: AuditModalTab; label: string; icon: typeof BarChart3 }[] = [
  { value: 'overview', label: 'Overview', icon: BarChart3 },
  { value: 'transactions', label: 'Transactions', icon: Receipt },
  { value: 'holdings', label: 'Holdings', icon: Wallet },
];

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  BRL: 'R$',
  EUR: '\u20AC',
  GBP: '\u00A3',
};

function formatCurrency(value: number | string | null | undefined, currency = 'USD'): string {
  const n = Number(value) || 0;
  const sym = CURRENCY_SYMBOLS[currency] ?? '$';
  if (Math.abs(n) >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${sym}${(n / 1_000).toFixed(2)}K`;
  return `${sym}${n.toFixed(2)}`;
}

function formatUsd(value: number | string | null | undefined): string {
  return formatCurrency(value, 'USD');
}

export default function AuditsPage() {
  const { connected, publicKey } = useWallet();
  const [filter, setFilter] = useState<FilterTab>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [modalAuditId, setModalAuditId] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) redirect('/');
  }, [connected]);

  const { data: audits, isLoading, error } = useQuery({
    queryKey: ['audits'],
    queryFn: () => listAudits(),
    refetchInterval: (query) => {
      const data = query.state.data as Audit[] | undefined;
      const hasActive = data?.some((a) => a.status === 'QUEUED' || a.status === 'PENDING' || a.status === 'PROCESSING');
      return hasActive ? 5000 : 30000;
    },
  });

  if (!connected || !publicKey) return null;

  const filtered = audits?.filter((a) => filter === 'ALL' || a.status === filter) ?? [];
  const modalAudit = audits?.find(a => a.id === modalAuditId);

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
              <h1 className="font-display text-2xl font-bold text-white">Audits</h1>
              <p className="text-sm text-white/30 mt-1">
                Tax compliance audits across your wallets
              </p>
            </div>
            <Link
              href="/audits/new"
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-background text-sm font-semibold hover:bg-primary-400 transition-all hover:scale-[1.02] self-start"
            >
              <Plus className="w-4 h-4" />
              New Audit
            </Link>
          </motion.div>

          {/* Filter tabs */}
          <motion.div variants={fadeUp}>
            <div className="flex items-center gap-1 bg-white/[0.03] rounded-xl p-1 w-fit">
              {FILTER_TABS.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setFilter(tab.value)}
                  className={`relative px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
                    filter === tab.value ? 'text-white' : 'text-white/30 hover:text-white/50'
                  }`}
                >
                  {filter === tab.value && (
                    <motion.div
                      layoutId="audit-filter-active"
                      className="absolute inset-0 bg-white/[0.06] rounded-lg"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                  <span className="relative">{tab.label}</span>
                </button>
              ))}
            </div>
          </motion.div>

          {/* Audit list */}
          <motion.div variants={fadeUp}>
            {isLoading ? (
              <div className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 p-12 flex flex-col items-center">
                <Loader2 className="w-6 h-6 text-primary/50 animate-spin mb-3" />
                <p className="text-sm text-white/30">Loading audits...</p>
              </div>
            ) : error ? (
              <div className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-red-500/20 p-8 flex flex-col items-center text-center">
                <AlertTriangle className="w-6 h-6 text-red-400 mb-3" />
                <p className="text-sm text-white/60 mb-1">Failed to load audits</p>
                <p className="text-xs text-white/25">{(error as Error).message}</p>
              </div>
            ) : !filtered.length ? (
              <div className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 p-12 flex flex-col items-center text-center">
                <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
                  <FileSearch className="w-8 h-8 text-white/10" />
                </div>
                <h3 className="font-display text-lg font-bold text-white/60 mb-1">
                  {filter === 'ALL' ? 'No audits yet' : `No ${filter.toLowerCase()} audits`}
                </h3>
                <p className="text-sm text-white/25 max-w-sm mb-6">
                  {filter === 'ALL'
                    ? 'Request your first tax compliance audit to get started.'
                    : 'No audits match this filter.'}
                </p>
                {filter === 'ALL' && (
                  <Link
                    href="/audits/new"
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-background text-sm font-semibold hover:bg-primary-400 transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    Request Audit
                  </Link>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map((audit) => (
                  <AuditCard
                    key={audit.id}
                    audit={audit}
                    expanded={expandedId === audit.id}
                    onToggle={() => {
                      if (audit.status === 'COMPLETED') {
                        setModalAuditId(audit.id);
                      } else {
                        setExpandedId(expandedId === audit.id ? null : audit.id);
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </motion.div>
        </motion.main>
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {modalAuditId && modalAudit && (
          <AuditDetailModal
            audit={modalAudit}
            onClose={() => setModalAuditId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function AuditCard({
  audit,
  expanded,
  onToggle,
}: {
  audit: Audit;
  expanded: boolean;
  onToggle: () => void;
}) {
  const config = STATUS_CONFIG[audit.status];
  const Icon = config.icon;
  const flag = JURISDICTION_FLAGS[audit.jurisdiction] ?? audit.jurisdiction;
  const date = new Date(audit.createdAt);

  return (
    <div className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 overflow-hidden hover:border-white/10 transition-all">
      <button
        onClick={onToggle}
        className="w-full px-6 py-5 flex items-center gap-4 text-left"
      >
        {/* Jurisdiction flag */}
        <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-2xl shrink-0">
          {flag}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-base font-semibold text-white/80">
              {audit.jurisdiction} Tax Audit
            </h3>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/5 text-white/30">
              {audit.taxYear}
            </span>
          </div>
          <p className="text-xs text-white/25">
            Created {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>

        {/* Status badge or action */}
        {audit.status === 'COMPLETED' ? (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-[11px] font-semibold shrink-0 hover:bg-primary/20 transition-colors">
            <FileSearch className="w-3 h-3" />
            View Results
          </span>
        ) : (
          <>
            <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${config.bg} ${config.color} text-[11px] font-medium shrink-0`}>
              <Icon className={`w-3 h-3 ${audit.status === 'PROCESSING' ? 'animate-spin' : ''}`} />
              {config.label}
            </span>
            <motion.div
              animate={{ rotate: expanded ? 90 : 0 }}
              transition={{ duration: 0.2 }}
              className="text-white/15 shrink-0"
            >
              <ChevronRight className="w-4 h-4" />
            </motion.div>
          </>
        )}
      </button>

      <AnimatePresence>
        {expanded && audit.status !== 'COMPLETED' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            {audit.status === 'PROCESSING' || audit.status === 'PENDING' || audit.status === 'QUEUED' ? (
              <div className="px-6 py-6 border-t border-white/5 bg-white/[0.01] flex items-center justify-center gap-3">
                <Loader2 className="w-4 h-4 text-primary/50 animate-spin" />
                <p className="text-sm text-white/30">
                  {audit.status === 'QUEUED' ? 'Queued for processing...' : audit.status === 'PENDING' ? 'Waiting to be processed...' : 'Audit in progress...'}
                </p>
              </div>
            ) : (
              <div className="px-6 py-6 border-t border-white/5 bg-white/[0.01] flex items-center justify-center gap-3">
                <AlertCircle className="w-4 h-4 text-white/20" />
                <p className="text-sm text-white/30">
                  {audit.status === 'FAILED' ? 'This audit encountered an error.' : 'This audit was cancelled.'}
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Detailed Result Modal ─────────────────────────────────────────── */

function AuditDetailModal({
  audit,
  onClose,
}: {
  audit: Audit;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<AuditModalTab>('overview');
  const { data: result, isLoading } = useQuery({
    queryKey: ['audit-result', audit.id],
    queryFn: () => getAuditResult(audit.id),
  });

  const flag = JURISDICTION_FLAGS[audit.jurisdiction] ?? audit.jurisdiction;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const hasIssues = result?.issues && result.issues.length > 0;
  const hasRecs = result?.recommendations && result.recommendations.length > 0;
  const currency = result?.currency ?? 'USD';
  const fmt = (v: number | string | null | undefined) => formatCurrency(v, currency);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-6 pb-6 px-4 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 16 }}
        transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="relative w-full max-w-5xl bg-surface/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* ── Header ── */}
        <div className="relative px-6 py-5 border-b border-white/[0.06]">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/[0.03] via-transparent to-transparent" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-xl">
                {flag}
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-white tracking-tight">
                  {audit.jurisdiction} Tax Audit
                </h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-white/30 font-mono">{audit.taxYear}</span>
                  <span className="w-1 h-1 rounded-full bg-white/10" />
                  <span className="text-xs text-white/25">
                    {new Date(audit.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/5 transition-colors text-white/25 hover:text-white/60"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {isLoading || !result ? (
          <div className="px-6 py-24 flex flex-col items-center">
            <div className="relative w-12 h-12">
              <div className="absolute inset-0 rounded-full border-2 border-white/[0.06]" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
            </div>
            <p className="text-sm text-white/25 mt-5">Analyzing audit results...</p>
          </div>
        ) : (
          <>
            {/* ── Hero Metrics ── */}
            <div className="px-6 pt-6 pb-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Net Gain/Loss */}
                <div className={`relative rounded-xl border px-5 py-4 overflow-hidden ${
                  Number(result.netGainLoss) >= 0
                    ? 'border-emerald-500/15 bg-emerald-500/[0.03]'
                    : 'border-red-500/15 bg-red-500/[0.03]'
                }`}>
                  <div className={`absolute top-0 left-0 w-[3px] h-full rounded-r ${
                    Number(result.netGainLoss) >= 0 ? 'bg-emerald-500/50' : 'bg-red-500/50'
                  }`} />
                  <p className="text-[10px] text-white/30 uppercase tracking-widest font-medium mb-2">
                    Net Gain / Loss
                  </p>
                  <p className={`text-2xl font-mono font-bold tracking-tight ${
                    Number(result.netGainLoss) >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {Number(result.netGainLoss) >= 0 ? '+' : ''}{fmt(result.netGainLoss)}
                  </p>
                  <p className="text-[10px] text-white/20 mt-1.5 font-mono">
                    {result.totalTransactions} transactions
                  </p>
                </div>

                {/* Total Income */}
                <div className="relative rounded-xl border border-blue-500/15 bg-blue-500/[0.03] px-5 py-4 overflow-hidden">
                  <div className="absolute top-0 left-0 w-[3px] h-full rounded-r bg-blue-500/50" />
                  <p className="text-[10px] text-white/30 uppercase tracking-widest font-medium mb-2">
                    Total Income
                  </p>
                  <p className="text-2xl font-mono font-bold tracking-tight text-blue-400">
                    {fmt(result.totalIncome)}
                  </p>
                  <p className="text-[10px] text-white/20 mt-1.5">
                    {result.income?.events?.length || 0} income events
                  </p>
                </div>

                {/* Estimated Tax */}
                <div className="relative rounded-xl border border-primary/15 bg-primary/[0.03] px-5 py-4 overflow-hidden">
                  <div className="absolute top-0 left-0 w-[3px] h-full rounded-r bg-primary/50" />
                  <p className="text-[10px] text-white/30 uppercase tracking-widest font-medium mb-2">
                    Estimated Tax
                  </p>
                  <p className="text-2xl font-mono font-bold tracking-tight text-primary">
                    {fmt(result.estimatedTax)}
                  </p>
                  <p className="text-[10px] text-white/20 mt-1.5">
                    {result.currency} &middot; {result.totalWallets} wallet{result.totalWallets !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
            </div>

            {/* ── Tab Bar ── */}
            <div className="px-6 border-b border-white/[0.06]">
              <div className="flex items-center gap-0.5">
                {MODAL_TABS.map((t) => {
                  const Icon = t.icon;
                  const isActive = tab === t.value;
                  let count: number | null = null;
                  if (t.value === 'transactions') {
                    count = (result.capitalGains?.transactions?.length || 0) + (result.income?.events?.length || 0);
                  } else if (t.value === 'holdings') {
                    count = result.holdings?.assets?.length || 0;
                  }
                  return (
                    <button
                      key={t.value}
                      onClick={() => setTab(t.value)}
                      className={`relative flex items-center gap-1.5 px-4 py-3 text-xs font-medium transition-colors ${
                        isActive ? 'text-white' : 'text-white/30 hover:text-white/50'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{t.label}</span>
                      {count !== null && count > 0 && (
                        <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-mono ${
                          isActive ? 'bg-white/10 text-white/60' : 'bg-white/[0.04] text-white/20'
                        }`}>
                          {count}
                        </span>
                      )}
                      {isActive && (
                        <motion.div
                          layoutId="audit-modal-tab"
                          className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full"
                          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Tab Content ── */}
            <div className="max-h-[52vh] overflow-y-auto">
              <AnimatePresence mode="wait">
                {/* ─── OVERVIEW TAB ─── */}
                {tab === 'overview' && (
                  <motion.div
                    key="overview"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15 }}
                    className="p-6 space-y-7"
                  >
                    {/* Capital Gains Breakdown */}
                    {result.capitalGains && (
                      <div>
                        <div className="flex items-center gap-2 mb-4">
                          <BarChart3 className="w-4 h-4 text-white/20" />
                          <h3 className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">
                            Capital Gains
                          </h3>
                        </div>

                        {/* Gain vs Loss visual bar */}
                        {(result.capitalGains.shortTermGains > 0 || Math.abs(result.capitalGains.shortTermLosses) > 0 ||
                          result.capitalGains.longTermGains > 0 || Math.abs(result.capitalGains.longTermLosses) > 0) && (() => {
                          const totalGains = result.capitalGains.shortTermGains + result.capitalGains.longTermGains;
                          const totalLosses = Math.abs(result.capitalGains.shortTermLosses) + Math.abs(result.capitalGains.longTermLosses);
                          const total = totalGains + totalLosses;
                          return (
                            <div className="mb-5">
                              <div className="flex h-2.5 rounded-full overflow-hidden bg-white/[0.03] gap-px">
                                {totalGains > 0 && (
                                  <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${(totalGains / total) * 100}%` }}
                                    transition={{ duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
                                    className="h-full bg-gradient-to-r from-emerald-500/40 to-emerald-500/25 rounded-l-full"
                                  />
                                )}
                                {totalLosses > 0 && (
                                  <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${(totalLosses / total) * 100}%` }}
                                    transition={{ duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.1 }}
                                    className="h-full bg-gradient-to-r from-red-500/25 to-red-500/40 rounded-r-full"
                                  />
                                )}
                              </div>
                              <div className="flex justify-between mt-2">
                                <span className="text-[10px] text-emerald-400/70 font-mono">
                                  Gains {fmt(totalGains)}
                                </span>
                                <span className="text-[10px] text-red-400/70 font-mono">
                                  Losses {fmt(totalLosses)}
                                </span>
                              </div>
                            </div>
                          );
                        })()}

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          <MiniStat label="Short-term Gains" value={fmt(result.capitalGains.shortTermGains)} color="text-emerald-400" />
                          <MiniStat label="Short-term Losses" value={fmt(result.capitalGains.shortTermLosses)} color="text-red-400" />
                          <MiniStat label="Net Short-term" value={fmt(result.capitalGains.netShortTerm)} color={result.capitalGains.netShortTerm >= 0 ? 'text-emerald-400' : 'text-red-400'} />
                          <MiniStat label="Long-term Gains" value={fmt(result.capitalGains.longTermGains)} color="text-emerald-400" />
                          <MiniStat label="Long-term Losses" value={fmt(result.capitalGains.longTermLosses)} color="text-red-400" />
                          <MiniStat label="Net Long-term" value={fmt(result.capitalGains.netLongTerm)} color={result.capitalGains.netLongTerm >= 0 ? 'text-emerald-400' : 'text-red-400'} />
                        </div>
                      </div>
                    )}

                    {/* Monthly Breakdown Chart (BR jurisdiction) */}
                    {result.metadata?.monthlyBreakdown && (
                      <MonthlyChart breakdown={result.metadata.monthlyBreakdown} />
                    )}

                    {/* Income Breakdown */}
                    {result.income && (
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <DollarSign className="w-4 h-4 text-white/20" />
                            <h3 className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">
                              Income
                            </h3>
                          </div>
                          <span className="text-xs font-mono text-blue-400/80">{fmt(result.income.total)}</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                          <MiniStat label="Staking" value={fmt(result.income.staking)} />
                          <MiniStat label="Earn / Yield" value={fmt(result.income.rewards)} />
                          <MiniStat label="Airdrops" value={fmt(result.income.airdrops)} />
                          <MiniStat label="Mining" value={fmt(result.income.mining)} />
                          <MiniStat label="Other" value={fmt(result.income.other)} />
                        </div>
                      </div>
                    )}

                    {/* Compliance: Issues + Recommendations */}
                    {(hasIssues || hasRecs) && (
                      <div>
                        <div className="flex items-center gap-2 mb-4">
                          <Shield className="w-4 h-4 text-white/20" />
                          <h3 className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">
                            Compliance
                          </h3>
                          {hasIssues && (
                            <span className="ml-auto text-[10px] font-mono text-amber-400/60">
                              {result.issues!.length} issue{result.issues!.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>

                        {hasIssues && (
                          <div className="space-y-2 mb-4">
                            {result.issues!.map((issue, i) => {
                              const sev: Record<string, { bar: string; badge: string }> = {
                                LOW: { bar: 'bg-white/10', badge: 'text-white/40 bg-white/5' },
                                MEDIUM: { bar: 'bg-amber-500/40', badge: 'text-amber-400 bg-amber-500/10' },
                                HIGH: { bar: 'bg-red-500/40', badge: 'text-red-400 bg-red-500/10' },
                              };
                              const s = sev[issue.severity] ?? sev.LOW;
                              return (
                                <div key={i} className="relative flex items-start gap-3 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.04] overflow-hidden">
                                  <div className={`absolute top-0 left-0 w-[3px] h-full ${s.bar}`} />
                                  <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium shrink-0 mt-0.5 ${s.badge}`}>
                                    {issue.severity}
                                  </span>
                                  <div className="min-w-0">
                                    <p className="text-xs font-medium text-white/60">{issue.type}</p>
                                    <p className="text-xs text-white/30 mt-0.5 leading-relaxed">{issue.description}</p>
                                    {issue.recommendation && (
                                      <p className="text-xs text-primary/50 mt-1.5 leading-relaxed">{issue.recommendation}</p>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {hasRecs && (
                          <div className="space-y-2">
                            <p className="text-[10px] text-white/20 uppercase tracking-wider mb-2">Recommendations</p>
                            {result.recommendations!.map((rec, i) => (
                              <div key={i} className="flex items-start gap-3 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                                <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                                  <Lightbulb className="w-3 h-3 text-primary/60" />
                                </div>
                                <p className="text-xs text-white/50 leading-relaxed">{rec}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </motion.div>
                )}

                {/* ─── TRANSACTIONS TAB ─── */}
                {tab === 'transactions' && (
                  <motion.div
                    key="transactions"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15 }}
                    className="p-6 space-y-7"
                  >
                    {/* Capital Gains Transactions */}
                    {result.capitalGains?.transactions?.length > 0 ? (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <BarChart3 className="w-4 h-4 text-white/20" />
                            <h3 className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">
                              Disposals
                            </h3>
                          </div>
                          <span className="text-[10px] text-white/20 font-mono">
                            {result.capitalGains.transactions.length} transactions
                          </span>
                        </div>
                        <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-white/[0.03]">
                                <th className="px-4 py-2.5 text-left text-[10px] font-medium text-white/25 uppercase tracking-wider">Asset</th>
                                <th className="px-4 py-2.5 text-left text-[10px] font-medium text-white/25 uppercase tracking-wider hidden sm:table-cell">Date</th>
                                <th className="px-4 py-2.5 text-right text-[10px] font-medium text-white/25 uppercase tracking-wider">Proceeds</th>
                                <th className="px-4 py-2.5 text-right text-[10px] font-medium text-white/25 uppercase tracking-wider hidden sm:table-cell">Cost Basis</th>
                                <th className="px-4 py-2.5 text-right text-[10px] font-medium text-white/25 uppercase tracking-wider">Gain/Loss</th>
                                <th className="px-4 py-2.5 text-center text-[10px] font-medium text-white/25 uppercase tracking-wider">Term</th>
                              </tr>
                            </thead>
                            <tbody>
                              {result.capitalGains.transactions.map((tx, i) => (
                                <tr key={i} className={`border-t border-white/[0.03] hover:bg-white/[0.02] transition-colors ${i % 2 !== 0 ? 'bg-white/[0.01]' : ''}`}>
                                  <td className="px-4 py-2.5 font-medium text-white/70">{tx.asset}</td>
                                  <td className="px-4 py-2.5 text-white/40 font-mono text-[11px] hidden sm:table-cell">
                                    {new Date(tx.dateSold).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  </td>
                                  <td className="px-4 py-2.5 text-right text-white/50 font-mono">{fmt(tx.proceeds)}</td>
                                  <td className="px-4 py-2.5 text-right text-white/50 font-mono hidden sm:table-cell">{fmt(tx.costBasis)}</td>
                                  <td className={`px-4 py-2.5 text-right font-mono font-semibold ${tx.gainLoss >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {tx.gainLoss >= 0 ? '+' : ''}{fmt(tx.gainLoss)}
                                  </td>
                                  <td className="px-4 py-2.5 text-center">
                                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-medium ${
                                      tx.type === 'LONG_TERM' ? 'bg-blue-500/10 text-blue-400' : 'bg-white/[0.04] text-white/35'
                                    }`}>
                                      {tx.type === 'LONG_TERM' ? 'Long' : 'Short'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="py-12 text-center">
                        <BarChart3 className="w-8 h-8 text-white/[0.06] mx-auto mb-3" />
                        <p className="text-xs text-white/25">No capital gain disposals in this period</p>
                      </div>
                    )}

                    {/* Income Events */}
                    {result.income?.events?.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <DollarSign className="w-4 h-4 text-white/20" />
                            <h3 className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">
                              Income Events
                            </h3>
                          </div>
                          <span className="text-[10px] text-white/20 font-mono">
                            {result.income.events.length} events
                          </span>
                        </div>
                        <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-white/[0.03]">
                                <th className="px-4 py-2.5 text-left text-[10px] font-medium text-white/25 uppercase tracking-wider">Type</th>
                                <th className="px-4 py-2.5 text-left text-[10px] font-medium text-white/25 uppercase tracking-wider">Asset</th>
                                <th className="px-4 py-2.5 text-left text-[10px] font-medium text-white/25 uppercase tracking-wider hidden sm:table-cell">Date</th>
                                <th className="px-4 py-2.5 text-right text-[10px] font-medium text-white/25 uppercase tracking-wider hidden sm:table-cell">Amount</th>
                                <th className="px-4 py-2.5 text-right text-[10px] font-medium text-white/25 uppercase tracking-wider">Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {result.income.events.map((ev, i) => (
                                <tr key={i} className={`border-t border-white/[0.03] hover:bg-white/[0.02] transition-colors ${i % 2 !== 0 ? 'bg-white/[0.01]' : ''}`}>
                                  <td className="px-4 py-2.5">
                                    <span className="px-2 py-0.5 rounded-full text-[9px] font-medium bg-blue-500/10 text-blue-400 capitalize">
                                      {ev.type}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 text-white/60 font-medium">{ev.asset}</td>
                                  <td className="px-4 py-2.5 text-white/40 font-mono text-[11px] hidden sm:table-cell">
                                    {new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  </td>
                                  <td className="px-4 py-2.5 text-right text-white/50 font-mono hidden sm:table-cell">{ev.amount.toFixed(4)}</td>
                                  <td className="px-4 py-2.5 text-right text-emerald-400 font-mono font-semibold">{fmt(ev.valueUsd)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}

                {/* ─── HOLDINGS TAB ─── */}
                {tab === 'holdings' && (
                  <motion.div
                    key="holdings"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15 }}
                    className="p-6"
                  >
                    {result.holdings?.assets?.length > 0 ? (
                      <>
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <Wallet className="w-4 h-4 text-white/20" />
                            <h3 className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">
                              Holdings at Period End
                            </h3>
                          </div>
                          <span className="text-xs font-mono text-white/30">
                            {fmt(result.holdings.totalValueUsd)} total
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {result.holdings.assets.map((asset, i) => (
                            <div key={i} className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:border-white/[0.08] transition-colors group">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center group-hover:border-white/[0.1] transition-colors">
                                  <span className="text-[10px] font-mono font-bold text-white/40">
                                    {asset.symbol.slice(0, 3)}
                                  </span>
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-white/80">{asset.symbol}</p>
                                  <p className="text-[10px] text-white/25 font-mono">{asset.balance.toFixed(6)}</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-mono font-medium text-white/60">{fmt(asset.costBasis)}</p>
                                <p className="text-[10px] text-white/20">cost basis</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="py-12 text-center">
                        <Wallet className="w-8 h-8 text-white/[0.06] mx-auto mb-3" />
                        <p className="text-xs text-white/25">No holdings data available</p>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ── Attestation Section ── */}
            <AttestationSection audit={audit} />

            {/* ── Footer ── */}
            <div className="px-6 py-3 border-t border-white/[0.04] flex items-center justify-between">
              <div className="flex items-center gap-3 text-[10px] text-white/20">
                <span className="px-1.5 py-0.5 rounded bg-white/[0.03] font-mono">
                  v{result.metadata?.version || '1.0'}
                </span>
                <span className="font-mono">Bee v{result.metadata?.beeVersion || '1.0'}</span>
                <span>{result.currency}</span>
                <span>{result.totalWallets} wallet{result.totalWallets !== 1 ? 's' : ''}</span>
              </div>
              {result.hash && (
                <span className="text-[10px] font-mono text-white/15 truncate max-w-[180px]">
                  {result.hash}
                </span>
              )}
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

function MonthlyChart({ breakdown }: { breakdown: MonthlyBreakdown }) {
  const maxVolume = Math.max(...breakdown.entries.map(e => e.salesVolume), breakdown.entries[0]?.threshold ?? 35000);
  const chartHeight = 180;
  const barWidth = 40;
  const gap = 8;
  const totalWidth = 12 * (barWidth + gap) - gap;
  const labelY = chartHeight + 18;
  const sym = CURRENCY_SYMBOLS[breakdown.currency] ?? '$';

  const fmtShort = (v: number) => {
    if (v >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${sym}${(v / 1_000).toFixed(0)}K`;
    return `${sym}${v.toFixed(0)}`;
  };

  const thresholdY = chartHeight - (breakdown.entries[0]?.threshold ?? 35000) / maxVolume * chartHeight;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="w-4 h-4 text-white/20" />
        <h3 className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">
          Monthly Sales Volume
        </h3>
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`-10 -20 ${totalWidth + 20} ${chartHeight + 45}`}
          className="w-full max-w-[700px]"
          style={{ minWidth: 500 }}
        >
          {/* Threshold line */}
          <line
            x1={-10}
            x2={totalWidth + 10}
            y1={thresholdY}
            y2={thresholdY}
            stroke="currentColor"
            strokeDasharray="4 3"
            className="text-amber-500/40"
            strokeWidth={1}
          />
          <text
            x={totalWidth + 10}
            y={thresholdY - 4}
            textAnchor="end"
            className="fill-amber-500/50"
            fontSize={8}
            fontFamily="monospace"
          >
            {fmtShort(breakdown.entries[0]?.threshold ?? 35000)}
          </text>

          {/* Bars */}
          {breakdown.entries.map((entry, i) => {
            const x = i * (barWidth + gap);
            const barHeight = maxVolume > 0 ? (entry.salesVolume / maxVolume) * chartHeight : 0;
            const y = chartHeight - barHeight;
            const color = entry.exempt ? '#34d399' : '#fbbf24';
            const opacity = entry.salesVolume > 0 ? 0.6 : 0.08;

            return (
              <g key={i}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(barHeight, 1)}
                  rx={4}
                  fill={color}
                  opacity={opacity}
                />
                {entry.salesVolume > 0 && (
                  <text
                    x={x + barWidth / 2}
                    y={y - 5}
                    textAnchor="middle"
                    className="fill-white/40"
                    fontSize={7}
                    fontFamily="monospace"
                  >
                    {fmtShort(entry.salesVolume)}
                  </text>
                )}
                <text
                  x={x + barWidth / 2}
                  y={labelY}
                  textAnchor="middle"
                  className="fill-white/30"
                  fontSize={9}
                >
                  {entry.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {/* Legend */}
      <div className="flex items-center gap-5 mt-3 text-[10px] text-white/30">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400/60" />
          Exempt ({'<'} {fmtShort(breakdown.entries[0]?.threshold ?? 35000)})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-400/60" />
          Taxable ({'\u2265'} {fmtShort(breakdown.entries[0]?.threshold ?? 35000)})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 border-t border-dashed border-amber-500/40" />
          Threshold
        </span>
      </div>
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        <MiniStat label="Exempt Gains" value={formatCurrency(breakdown.totalExemptGains, breakdown.currency)} color="text-emerald-400" />
        <MiniStat label="Taxable Gains" value={formatCurrency(breakdown.totalTaxableGains, breakdown.currency)} color="text-amber-400" />
        <MiniStat label="Exempt Months" value={String(breakdown.exemptMonths)} color="text-emerald-400" />
        <MiniStat label="Taxable Months" value={String(breakdown.taxableMonths)} color="text-amber-400" />
      </div>
    </div>
  );
}

/* ─── Attestation Section ─────────────────────────────────────────── */

const EXPLORER_BASE = 'https://explorer.solana.com';

function AttestationSection({ audit }: { audit: Audit }) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attestationId, setAttestationId] = useState<string | null>(null);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [revoking, setRevoking] = useState(false);

  // Fetch attestation for this audit by checking wallet attestations
  const { data: attestations } = useQuery({
    queryKey: ['attestations', audit.walletId],
    queryFn: () => getWalletAttestations(audit.walletId),
    enabled: !!audit.walletId,
  });

  // Find attestation matching this audit
  const existingAttestation = attestations?.find((a) => a.auditId === audit.id);

  // Poll for status changes when PENDING
  const activeId = attestationId || existingAttestation?.id;
  const { data: polledAttestation } = useQuery({
    queryKey: ['attestation', activeId],
    queryFn: () => getAttestation(activeId!),
    enabled: !!activeId,
    refetchInterval: (query) => {
      const data = query.state.data as Attestation | undefined;
      return data?.status === 'PENDING' ? 5000 : false;
    },
  });

  // Use the most up-to-date data
  const attestation = polledAttestation || existingAttestation;

  const handleCreate = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const result = await createAttestation(audit.id, 'TAX_COMPLIANCE');
      setAttestationId(result.id);
      queryClient.invalidateQueries({ queryKey: ['attestations', audit.walletId] });
    } catch (err) {
      setError((err as Error).message || 'Failed to create attestation');
    } finally {
      setCreating(false);
    }
  }, [audit.id, audit.walletId, queryClient]);

  const handleRevoke = useCallback(async () => {
    if (!attestation) return;
    setRevoking(true);
    try {
      await revokeAttestation(attestation.id, revokeReason || 'Revoked by user');
      setShowRevokeConfirm(false);
      setRevokeReason('');
      queryClient.invalidateQueries({ queryKey: ['attestation', attestation.id] });
      queryClient.invalidateQueries({ queryKey: ['attestations', audit.walletId] });
    } catch (err) {
      setError((err as Error).message || 'Failed to revoke attestation');
    } finally {
      setRevoking(false);
    }
  }, [attestation, revokeReason, audit.walletId, queryClient]);

  const status = attestation?.status;

  return (
    <div className="px-6 py-5 border-t border-white/[0.06]">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="w-4 h-4 text-white/20" />
        <h3 className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">
          On-Chain Attestation
        </h3>
      </div>

      {/* Error display */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/[0.06] border border-red-500/15 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-red-400 font-medium">Attestation Error</p>
            <p className="text-xs text-red-400/60 mt-0.5">{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400/40 hover:text-red-400 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* No attestation yet -- show create button */}
      {!attestation && !creating && (
        <button
          onClick={handleCreate}
          className="flex items-center gap-2.5 px-5 py-3 rounded-xl bg-primary/10 border border-primary/20 text-primary text-sm font-semibold hover:bg-primary/15 hover:border-primary/30 transition-all group"
        >
          <ShieldCheck className="w-4.5 h-4.5 group-hover:scale-110 transition-transform" />
          Create On-Chain Attestation
        </button>
      )}

      {/* Creating / Pending */}
      {(creating || status === 'PENDING') && (
        <div className="flex items-center gap-3.5 px-5 py-4 rounded-xl bg-amber-500/[0.04] border border-amber-500/15">
          <div className="relative w-8 h-8 shrink-0">
            <div className="absolute inset-0 rounded-full border-2 border-white/[0.06]" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-amber-400 animate-spin" />
          </div>
          <div>
            <p className="text-sm font-medium text-amber-400">Creating on-chain attestation...</p>
            <p className="text-xs text-white/25 mt-0.5">
              Submitting to Solana devnet. This may take a few seconds.
            </p>
          </div>
        </div>
      )}

      {/* Active attestation */}
      {(status === 'ACTIVE' || status === 'CONFIRMED') && attestation && (
        <div className="rounded-xl bg-emerald-500/[0.04] border border-emerald-500/15 overflow-hidden">
          <div className="px-5 py-4 flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-emerald-400">On-Chain Attestation Active</p>
              <p className="text-xs text-white/25 mt-0.5">
                Tax compliance verified and recorded on Solana
              </p>

              <div className="mt-3 space-y-2">
                {/* On-chain account link */}
                {attestation.onChainAccount && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-white/25 w-20 shrink-0">PDA Account</span>
                    <a
                      href={`${EXPLORER_BASE}/address/${attestation.onChainAccount}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs font-mono text-primary/80 hover:text-primary transition-colors truncate"
                    >
                      {attestation.onChainAccount.slice(0, 8)}...{attestation.onChainAccount.slice(-8)}
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  </div>
                )}

                {/* Transaction signature link */}
                {attestation.onChainSignature && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-white/25 w-20 shrink-0">Transaction</span>
                    <a
                      href={`${EXPLORER_BASE}/tx/${attestation.onChainSignature}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs font-mono text-primary/80 hover:text-primary transition-colors truncate"
                    >
                      {attestation.onChainSignature.slice(0, 8)}...{attestation.onChainSignature.slice(-8)}
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  </div>
                )}

                {/* Expiration */}
                {attestation.expiresAt && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-white/25 w-20 shrink-0">Expires</span>
                    <span className="text-xs text-white/40 font-mono">
                      {new Date(attestation.expiresAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                )}

                {/* Hash */}
                {attestation.hash && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-white/25 w-20 shrink-0">Data Hash</span>
                    <span className="text-xs text-white/25 font-mono truncate">
                      {attestation.hash.slice(0, 16)}...
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Revoke button */}
          <div className="px-5 py-3 border-t border-emerald-500/10 flex items-center justify-end">
            {!showRevokeConfirm ? (
              <button
                onClick={() => setShowRevokeConfirm(true)}
                className="flex items-center gap-1.5 text-[11px] text-white/20 hover:text-red-400 transition-colors"
              >
                <Ban className="w-3 h-3" />
                Revoke Attestation
              </button>
            ) : (
              <div className="flex items-center gap-3 w-full">
                <input
                  type="text"
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  placeholder="Reason for revocation..."
                  className="flex-1 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs text-white/60 placeholder:text-white/15 focus:outline-none focus:border-red-500/30"
                />
                <button
                  onClick={handleRevoke}
                  disabled={revoking}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-medium hover:bg-red-500/15 transition-colors disabled:opacity-50"
                >
                  {revoking ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Ban className="w-3 h-3" />
                  )}
                  Confirm
                </button>
                <button
                  onClick={() => {
                    setShowRevokeConfirm(false);
                    setRevokeReason('');
                  }}
                  className="text-xs text-white/20 hover:text-white/40 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Revoked */}
      {status === 'REVOKED' && attestation && (
        <div className="flex items-start gap-3.5 px-5 py-4 rounded-xl bg-red-500/[0.04] border border-red-500/15">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
            <ShieldX className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-red-400">Attestation Revoked</p>
            <p className="text-xs text-white/25 mt-0.5">
              {attestation.revokeReason || 'This attestation has been revoked.'}
            </p>
            {attestation.revokedAt && (
              <p className="text-[10px] text-white/15 mt-1 font-mono">
                Revoked {new Date(attestation.revokedAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Expired */}
      {status === 'EXPIRED' && attestation && (
        <div className="flex items-start gap-3.5 px-5 py-4 rounded-xl bg-amber-500/[0.04] border border-amber-500/15">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-amber-400">Attestation Expired</p>
            <p className="text-xs text-white/25 mt-0.5">
              This attestation expired on{' '}
              {attestation.expiresAt
                ? new Date(attestation.expiresAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })
                : 'an unknown date'}
              .
            </p>
          </div>
        </div>
      )}

      {/* Failed */}
      {status === 'FAILED' && attestation && (
        <div className="flex items-start gap-3.5 px-5 py-4 rounded-xl bg-red-500/[0.04] border border-red-500/15">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
            <ShieldX className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-red-400">Attestation Failed</p>
            <p className="text-xs text-white/25 mt-0.5">
              The on-chain attestation could not be created. You can try again.
            </p>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="mt-2 flex items-center gap-1.5 text-xs text-primary/80 hover:text-primary transition-colors"
            >
              {creating ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ShieldCheck className="w-3 h-3" />
              )}
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="px-3.5 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
      <p className="text-[10px] text-white/25 mb-1">{label}</p>
      <p className={`text-sm font-mono font-semibold ${color ?? 'text-white/50'}`}>{value}</p>
    </div>
  );
}
