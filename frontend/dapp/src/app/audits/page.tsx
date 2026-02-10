'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import {
  FileSearch,
  Plus,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  DollarSign,
  BarChart3,
  AlertCircle,
} from 'lucide-react';
import { Navbar } from '@/components/dashboard/Sidebar';
import {
  listAudits,
  getAuditResult,
  type Audit,
  type AuditStatus,
  type AuditResult,
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

function formatUsd(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

export default function AuditsPage() {
  const { connected, publicKey } = useWallet();
  const [filter, setFilter] = useState<FilterTab>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) redirect('/');
  }, [connected]);

  const { data: audits, isLoading, error } = useQuery({
    queryKey: ['audits'],
    queryFn: () => listAudits(),
    refetchInterval: (query) => {
      const data = query.state.data as Audit[] | undefined;
      const hasActive = data?.some((a) => a.status === 'PENDING' || a.status === 'PROCESSING');
      return hasActive ? 5000 : 30000;
    },
  });

  if (!connected || !publicKey) return null;

  const filtered = audits?.filter((a) => filter === 'ALL' || a.status === filter) ?? [];

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
                    onToggle={() => setExpandedId(expandedId === audit.id ? null : audit.id)}
                  />
                ))}
              </div>
            )}
          </motion.div>
        </motion.main>
      </div>
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
          <div className="flex items-center gap-2 mb-1">
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

        {/* Status badge */}
        <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${config.bg} ${config.color} text-[11px] font-medium shrink-0`}>
          <Icon className={`w-3 h-3 ${audit.status === 'PROCESSING' ? 'animate-spin' : ''}`} />
          {config.label}
        </span>

        {/* Expand */}
        <motion.div
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.2 }}
          className="text-white/15 shrink-0"
        >
          <ChevronRight className="w-4 h-4" />
        </motion.div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            {audit.status === 'COMPLETED' ? (
              <AuditResultPanel auditId={audit.id} />
            ) : audit.status === 'PROCESSING' || audit.status === 'PENDING' ? (
              <div className="px-6 py-6 border-t border-white/5 bg-white/[0.01] flex items-center justify-center gap-3">
                <Loader2 className="w-4 h-4 text-primary/50 animate-spin" />
                <p className="text-sm text-white/30">
                  {audit.status === 'PENDING' ? 'Waiting to be processed...' : 'Audit in progress...'}
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

function AuditResultPanel({ auditId }: { auditId: string }) {
  const { data: result, isLoading, error } = useQuery({
    queryKey: ['audit-result', auditId],
    queryFn: () => getAuditResult(auditId),
  });

  if (isLoading) {
    return (
      <div className="px-6 py-8 border-t border-white/5 bg-white/[0.01] flex items-center justify-center gap-2">
        <Loader2 className="w-4 h-4 text-primary/40 animate-spin" />
        <span className="text-xs text-white/25">Loading results...</span>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="px-6 py-6 border-t border-white/5 bg-white/[0.01] flex items-center justify-center gap-2">
        <AlertTriangle className="w-4 h-4 text-red-400/50" />
        <span className="text-xs text-white/30">Failed to load results</span>
      </div>
    );
  }

  return (
    <div className="border-t border-white/5 bg-white/[0.01]">
      {/* Summary stats */}
      <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-5 gap-4 border-b border-white/[0.03]">
        <ResultStat icon={DollarSign} label="Total Income" value={formatUsd(result.totalIncome)} />
        <ResultStat icon={TrendingUp} label="Total Gains" value={formatUsd(result.totalGains)} color="text-emerald-400" />
        <ResultStat icon={TrendingDown} label="Total Losses" value={formatUsd(result.totalLosses)} color="text-red-400" />
        <ResultStat
          icon={BarChart3}
          label="Net Gain/Loss"
          value={`${result.netGainLoss >= 0 ? '+' : ''}${formatUsd(result.netGainLoss)}`}
          color={result.netGainLoss >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
        <ResultStat icon={FileSearch} label="Taxable Events" value={String(result.taxableEvents)} />
      </div>

      {/* AI summary */}
      {result.summary && (
        <div className="px-6 py-4 border-b border-white/[0.03]">
          <p className="text-[11px] text-white/20 uppercase tracking-wider mb-2">Summary</p>
          <p className="text-sm text-white/50 leading-relaxed">{result.summary}</p>
        </div>
      )}

      {/* Findings */}
      {result.findings?.length > 0 && (
        <div className="px-6 py-4">
          <p className="text-[11px] text-white/20 uppercase tracking-wider mb-3">Findings</p>
          <div className="space-y-2">
            {result.findings.map((finding, i) => {
              const severityColor: Record<string, string> = {
                LOW: 'text-white/40 bg-white/5',
                MEDIUM: 'text-amber-400 bg-amber-500/10',
                HIGH: 'text-red-400 bg-red-500/10',
              };
              const color = severityColor[finding.severity] ?? severityColor.LOW;

              return (
                <div key={i} className="flex items-start gap-3 px-4 py-3 rounded-xl bg-white/[0.02]">
                  <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium shrink-0 mt-0.5 ${color}`}>
                    {finding.severity}
                  </span>
                  <div>
                    <p className="text-xs font-medium text-white/60">{finding.type}</p>
                    <p className="text-xs text-white/30 mt-0.5">{finding.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ResultStat({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3 h-3 text-white/20" />
        <p className="text-[10px] text-white/20 uppercase tracking-wider">{label}</p>
      </div>
      <p className={`text-sm font-mono font-medium ${color ?? 'text-white/60'}`}>{value}</p>
    </div>
  );
}
