'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { redirect } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileCheck,
  FileText,
  FileSpreadsheet,
  FileJson,
  Download,
  Plus,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  X,
  ChevronDown,
} from 'lucide-react';
import { Navbar } from '@/components/dashboard/Sidebar';
import {
  listAudits,
  getReportsForAudit,
  createReport,
  getReportDownload,
  type Audit,
  type Report,
  type ReportStatus,
  type GenerateReportDto,
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

const FORMAT_ICONS: Record<string, typeof FileText> = {
  PDF: FileText,
  CSV: FileSpreadsheet,
  XLSX: FileSpreadsheet,
  JSON: FileJson,
};

const STATUS_CONFIG: Record<ReportStatus, { icon: typeof Clock; label: string; color: string; bg: string }> = {
  PENDING: { icon: Clock, label: 'Pending', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  PROCESSING: { icon: Loader2, label: 'Generating', color: 'text-blue-400', bg: 'bg-blue-500/10' },
  COMPLETED: { icon: CheckCircle2, label: 'Ready', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  FAILED: { icon: XCircle, label: 'Failed', color: 'text-red-400', bg: 'bg-red-500/10' },
};

const REPORT_FORMATS = [
  { type: 'PDF' as const, format: 'Form8949', label: 'Form 8949 (PDF)', jurisdiction: 'US' },
  { type: 'PDF' as const, format: 'ScheduleD', label: 'Schedule D (PDF)', jurisdiction: 'US' },
  { type: 'CSV' as const, format: 'TaxSummary', label: 'Tax Summary (CSV)', jurisdiction: 'ALL' },
  { type: 'XLSX' as const, format: 'FullReport', label: 'Full Report (XLSX)', jurisdiction: 'ALL' },
  { type: 'PDF' as const, format: 'IN1888', label: 'IN 1888 (PDF)', jurisdiction: 'BR' },
  { type: 'JSON' as const, format: 'RawData', label: 'Raw Data (JSON)', jurisdiction: 'ALL' },
];

function formatBytes(bytes: number | null): string {
  if (!bytes) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ReportsPage() {
  const { connected, publicKey } = useWallet();
  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [auditDropdownOpen, setAuditDropdownOpen] = useState(false);

  useEffect(() => {
    if (!connected) redirect('/');
  }, [connected]);

  const { data: audits, isLoading: auditsLoading } = useQuery({
    queryKey: ['audits'],
    queryFn: () => listAudits(),
  });

  // Auto-select first completed audit
  useEffect(() => {
    if (!selectedAuditId && audits?.length) {
      const completed = audits.find((a) => a.status === 'COMPLETED');
      if (completed) setSelectedAuditId(completed.id);
      else setSelectedAuditId(audits[0].id);
    }
  }, [audits, selectedAuditId]);

  const { data: reports, isLoading: reportsLoading } = useQuery({
    queryKey: ['reports', selectedAuditId],
    queryFn: () => getReportsForAudit(selectedAuditId!),
    enabled: !!selectedAuditId,
    refetchInterval: (query) => {
      const data = query.state.data as Report[] | undefined;
      const hasActive = data?.some((r) => r.status === 'PENDING' || r.status === 'PROCESSING');
      return hasActive ? 5000 : 30000;
    },
  });

  if (!connected || !publicKey) return null;

  const selectedAudit = audits?.find((a) => a.id === selectedAuditId);
  const completedAudits = audits?.filter((a) => a.status === 'COMPLETED') ?? [];

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
              <h1 className="font-display text-2xl font-bold text-white">Reports</h1>
              <p className="text-sm text-white/30 mt-1">
                Generated tax reports and documents
              </p>
            </div>
            {completedAudits.length > 0 && (
              <button
                onClick={() => setShowGenerateDialog(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-background text-sm font-semibold hover:bg-primary-400 transition-all hover:scale-[1.02] self-start"
              >
                <Plus className="w-4 h-4" />
                Generate Report
              </button>
            )}
          </motion.div>

          {auditsLoading ? (
            <motion.div variants={fadeUp} className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 p-12 flex flex-col items-center">
              <Loader2 className="w-6 h-6 text-primary/50 animate-spin mb-3" />
              <p className="text-sm text-white/30">Loading...</p>
            </motion.div>
          ) : !audits?.length ? (
            <motion.div variants={fadeUp} className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 p-12 flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
                <FileCheck className="w-8 h-8 text-white/10" />
              </div>
              <h3 className="font-display text-lg font-bold text-white/60 mb-1">No reports yet</h3>
              <p className="text-sm text-white/25 max-w-sm">
                Complete an audit first, then generate tax reports in various formats.
              </p>
            </motion.div>
          ) : (
            <>
              {/* Audit selector */}
              <motion.div variants={fadeUp}>
                <div className="relative w-full sm:w-80">
                  <button
                    onClick={() => setAuditDropdownOpen(!auditDropdownOpen)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-surface/40 backdrop-blur-sm border border-white/5 hover:border-white/10 transition-all"
                  >
                    {selectedAudit ? (
                      <span className="flex items-center gap-2 text-sm text-white/60">
                        <span className="text-base">{JURISDICTION_FLAGS[selectedAudit.jurisdiction] ?? ''}</span>
                        {selectedAudit.jurisdiction} {selectedAudit.taxYear}
                        <span className="text-xs text-white/20">
                          {new Date(selectedAudit.createdAt).toLocaleDateString()}
                        </span>
                      </span>
                    ) : (
                      <span className="text-sm text-white/30">Select an audit</span>
                    )}
                    <ChevronDown className={`w-4 h-4 text-white/20 transition-transform ${auditDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  <AnimatePresence>
                    {auditDropdownOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="absolute z-20 top-full mt-1 w-full rounded-xl bg-surface border border-white/10 shadow-2xl overflow-hidden"
                      >
                        {audits.map((audit) => (
                          <button
                            key={audit.id}
                            onClick={() => {
                              setSelectedAuditId(audit.id);
                              setAuditDropdownOpen(false);
                            }}
                            className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.04] transition-colors ${
                              selectedAuditId === audit.id ? 'bg-white/[0.04]' : ''
                            }`}
                          >
                            <span className="text-base">{JURISDICTION_FLAGS[audit.jurisdiction] ?? ''}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-white/60">{audit.jurisdiction} {audit.taxYear}</p>
                              <p className="text-[10px] text-white/20">{audit.status}</p>
                            </div>
                            {selectedAuditId === audit.id && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
                            )}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>

              {/* Report list */}
              <motion.div variants={fadeUp}>
                {reportsLoading ? (
                  <div className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 p-12 flex flex-col items-center">
                    <Loader2 className="w-5 h-5 text-primary/50 animate-spin mb-3" />
                    <p className="text-sm text-white/30">Loading reports...</p>
                  </div>
                ) : !reports?.length ? (
                  <div className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 p-12 flex flex-col items-center text-center">
                    <FileCheck className="w-8 h-8 text-white/10 mb-3" />
                    <p className="text-sm text-white/30 mb-1">No reports for this audit</p>
                    <p className="text-xs text-white/15">
                      {selectedAudit?.status === 'COMPLETED'
                        ? 'Generate a report to get started.'
                        : 'Complete this audit first to generate reports.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {reports.map((report) => (
                      <ReportCard key={report.id} report={report} />
                    ))}
                  </div>
                )}
              </motion.div>
            </>
          )}
        </motion.main>
      </div>

      {/* Generate report dialog */}
      <AnimatePresence>
        {showGenerateDialog && selectedAuditId && (
          <GenerateReportDialog
            auditId={selectedAuditId}
            jurisdiction={selectedAudit?.jurisdiction}
            onClose={() => setShowGenerateDialog(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ReportCard({ report }: { report: Report }) {
  const queryClient = useQueryClient();
  const config = STATUS_CONFIG[report.status] ?? { icon: Clock, label: report.status, color: 'text-gray-400', bg: 'bg-gray-500/10' };
  const StatusIcon = config.icon;
  const FormatIcon = FORMAT_ICONS[report.format] ?? FileText;
  const date = new Date(report.createdAt);

  const downloadMutation = useMutation({
    mutationFn: () => getReportDownload(report.id),
    onSuccess: (data) => {
      window.open(data.url, '_blank');
    },
  });

  return (
    <div className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 overflow-hidden hover:border-white/10 transition-all px-6 py-5">
      <div className="flex items-center gap-4">
        {/* Format icon */}
        <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
          <FormatIcon className="w-6 h-6 text-white/25" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-white/80">{report.format}</h3>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/5 text-white/30 uppercase">
              {report.format}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-white/25">
            <span>{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            {report.fileSizeBytes && (
              <>
                <span className="text-white/10">&middot;</span>
                <span>{formatBytes(report.fileSizeBytes)}</span>
              </>
            )}
          </div>
        </div>

        {/* Status */}
        <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${config.bg} ${config.color} text-[11px] font-medium shrink-0`}>
          <StatusIcon className={`w-3 h-3 ${report.status === 'PROCESSING' ? 'animate-spin' : ''}`} />
          {config.label}
        </span>

        {/* Download */}
        {report.status === 'COMPLETED' && (
          <button
            onClick={() => downloadMutation.mutate()}
            disabled={downloadMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-[11px] font-medium hover:bg-primary/20 transition-colors disabled:opacity-50 shrink-0"
          >
            {downloadMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Download className="w-3 h-3" />
            )}
            Download
          </button>
        )}
      </div>
    </div>
  );
}

function GenerateReportDialog({
  auditId,
  jurisdiction,
  onClose,
}: {
  auditId: string;
  jurisdiction?: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<{ type: GenerateReportDto['type']; format: string } | null>(null);

  const availableFormats = REPORT_FORMATS.filter(
    (f) => f.jurisdiction === 'ALL' || f.jurisdiction === jurisdiction,
  );

  const mutation = useMutation({
    mutationFn: () =>
      createReport({
        auditId,
        type: selected!.type,
        format: selected!.format,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports', auditId] });
      onClose();
    },
  });

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
        <div className="w-full max-w-md bg-surface border border-white/5 rounded-2xl overflow-hidden shadow-2xl">
          {/* Header */}
          <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Plus className="w-5 h-5 text-primary" />
              </div>
              <h2 className="font-display text-lg font-bold text-white">Generate Report</h2>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white/30 hover:text-white hover:bg-white/10 transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Format selection */}
          <div className="p-6 space-y-3">
            <p className="text-xs text-white/40 uppercase tracking-wider font-medium mb-3">
              Select format
            </p>
            {availableFormats.map((fmt) => {
              const Icon = FORMAT_ICONS[fmt.type] ?? FileText;
              const isSelected = selected?.format === fmt.format && selected?.type === fmt.type;

              return (
                <button
                  key={`${fmt.type}-${fmt.format}`}
                  onClick={() => setSelected({ type: fmt.type, format: fmt.format })}
                  className={`w-full flex items-center gap-3 p-4 rounded-xl border transition-all text-left ${
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-white/5 hover:border-white/10 bg-white/[0.02]'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${isSelected ? 'text-primary' : 'text-white/20'}`} />
                  <span className="text-sm text-white/70 font-medium">{fmt.label}</span>
                </button>
              );
            })}

            {mutation.isError && (
              <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <p className="text-xs text-red-400">{(mutation.error as Error).message}</p>
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
                onClick={() => mutation.mutate()}
                disabled={!selected || mutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-background text-sm font-semibold hover:bg-primary-400 transition-all disabled:opacity-50"
              >
                {mutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FileCheck className="w-4 h-4" />
                )}
                Generate
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </>
  );
}
