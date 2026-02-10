'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  ChevronRight,
  RefreshCw,
  ArrowRight,
} from 'lucide-react';
import Link from 'next/link';
import { type Jurisdiction, type TaxObligation } from '@/lib/constants';

interface TaxObligationsProps {
  jurisdictions: Jurisdiction[];
}

const frequencyLabels: Record<TaxObligation['frequency'], string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
};

const frequencyColors: Record<TaxObligation['frequency'], string> = {
  monthly: 'bg-violet-500/10 text-violet-400',
  quarterly: 'bg-blue-500/10 text-blue-400',
  annual: 'bg-emerald-500/10 text-emerald-400',
};

const statusConfig: Record<
  TaxObligation['status'],
  { icon: typeof Clock; label: string; color: string; dot: string; bg: string }
> = {
  overdue: {
    icon: AlertTriangle,
    label: 'Overdue',
    color: 'text-red-400',
    dot: 'bg-red-400',
    bg: 'bg-red-500/10',
  },
  pending: {
    icon: Clock,
    label: 'Pending',
    color: 'text-amber-400',
    dot: 'bg-amber-400',
    bg: 'bg-amber-500/10',
  },
  upcoming: {
    icon: Calendar,
    label: 'Upcoming',
    color: 'text-white/40',
    dot: 'bg-white/25',
    bg: 'bg-white/5',
  },
  completed: {
    icon: CheckCircle2,
    label: 'Completed',
    color: 'text-emerald-400',
    dot: 'bg-emerald-400',
    bg: 'bg-emerald-500/10',
  },
};

export function TaxObligations({ jurisdictions }: TaxObligationsProps) {
  const [activeTab, setActiveTab] = useState(jurisdictions[0]?.code ?? '');

  const activeJurisdiction = jurisdictions.find((j) => j.code === activeTab);
  const obligations = activeJurisdiction?.obligations ?? [];

  return (
    <div className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-white/5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-white">Tax Obligations</h2>
              <p className="text-xs text-white/30">Region-specific compliance requirements</p>
            </div>
          </div>
        </div>

        {/* Jurisdiction tabs */}
        <div className="flex items-center gap-1 bg-white/[0.03] rounded-xl p-1">
          {jurisdictions.map((j) => {
            const isActive = activeTab === j.code;
            const hasOverdue = j.obligations.some((o) => o.status === 'overdue');

            return (
              <button
                key={j.code}
                onClick={() => setActiveTab(j.code)}
                className="relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {isActive && (
                  <motion.div
                    layoutId="tax-tab-active"
                    className="absolute inset-0 bg-white/[0.06] rounded-lg"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
                <span className="relative">{j.flag}</span>
                <span
                  className={`relative ${
                    isActive ? 'text-white' : 'text-white/40'
                  }`}
                >
                  {j.code}
                </span>
                {hasOverdue && (
                  <span className="relative w-1.5 h-1.5 bg-red-400 rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Obligations list */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {obligations.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-white/30">
                No obligations configured for this jurisdiction.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.03]">
              {obligations.map((obligation) => (
                <ObligationRow key={obligation.id} obligation={obligation} />
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between">
        <p className="text-[11px] text-white/20">
          {obligations.length} obligation{obligations.length !== 1 ? 's' : ''} for{' '}
          {activeJurisdiction?.name ?? ''}
        </p>
        <Link
          href="/audits/new"
          className="text-xs text-primary/70 hover:text-primary flex items-center gap-1 transition-colors font-medium"
        >
          Generate reports
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}

// ─── ObligationRow ───────────────────────────────────────────────────

function ObligationRow({ obligation }: { obligation: TaxObligation }) {
  const config = statusConfig[obligation.status];
  const StatusIcon = config.icon;

  return (
    <div className="group px-6 py-4 hover:bg-white/[0.015] transition-colors">
      <div className="flex items-start gap-4">
        {/* Status indicator */}
        <div className={`w-9 h-9 rounded-xl ${config.bg} flex items-center justify-center shrink-0 mt-0.5`}>
          <StatusIcon className={`w-4 h-4 ${config.color}`} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-semibold text-white/80 truncate">
              {obligation.name}
            </h4>
          </div>
          <p className="text-xs text-white/30 leading-relaxed mb-2.5 line-clamp-2">
            {obligation.description}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${frequencyColors[obligation.frequency]}`}>
              {frequencyLabels[obligation.frequency]}
            </span>
            <span className="text-[10px] text-white/20">|</span>
            <span className="flex items-center gap-1 text-[11px] text-white/40">
              <Calendar className="w-3 h-3" />
              {obligation.nextDeadline}
            </span>
            <span className="text-[10px] text-white/20">|</span>
            <span className={`flex items-center gap-1 text-[11px] font-medium ${config.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${config.dot} ${obligation.status === 'overdue' ? 'animate-pulse' : ''}`} />
              {config.label}
            </span>
          </div>
        </div>

        {/* Action */}
        <button className="shrink-0 w-8 h-8 rounded-lg bg-white/[0.03] flex items-center justify-center text-white/15 hover:text-primary hover:bg-primary/10 transition-all opacity-0 group-hover:opacity-100">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
