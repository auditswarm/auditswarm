'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { redirect } from 'next/navigation';
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Wallet,
  Plus,
  RefreshCw,
  Trash2,
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Pause,
  Users,
  ArrowLeftRight,
  ChevronRight,
  Tag,
  X,
  Ghost,
  Link2,
  Activity,
  Calendar,
  Globe,
} from 'lucide-react';
import { Navbar } from '@/components/dashboard/Sidebar';
import {
  listWallets,
  createWallet,
  deleteWallet,
  getSyncStatus,
  syncWallet,
  getCounterpartySuggestions,
  claimCounterparty,
  type Wallet as WalletType,
  type SyncStatus,
  type Counterparty,
} from '@/lib/api';

const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] } },
};

const container = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.08 } },
};

export default function WalletsPage() {
  const { connected, publicKey } = useWallet();
  const [showAddDialog, setShowAddDialog] = useState(false);

  useEffect(() => {
    if (!connected) redirect('/');
  }, [connected]);

  if (!connected || !publicKey) return null;

  return (
    <div className="min-h-screen bg-background">
      <div className="fixed inset-0 pointer-events-none">
        <div className="fixed inset-0 honeycomb-bg opacity-30" />
        <div className="fixed inset-0 bg-gradient-to-b from-blue-500/[0.015] via-transparent to-transparent" />
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
          <motion.div variants={fadeUp} className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-500/5 flex items-center justify-center border border-blue-500/10">
                <Wallet className="w-5.5 h-5.5 text-blue-400" />
              </div>
              <div>
                <h1 className="font-display text-2xl font-bold text-white">Wallets</h1>
                <p className="text-sm text-white/30 mt-0.5">
                  Manage connected wallets and track indexing status
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowAddDialog(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-background text-sm font-semibold hover:bg-primary-400 transition-all hover:scale-[1.02] shadow-lg shadow-primary/10"
            >
              <Plus className="w-4 h-4" />
              Add Wallet
            </button>
          </motion.div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            {/* Wallet list */}
            <motion.div variants={fadeUp} className="xl:col-span-2 space-y-3">
              <WalletList />
            </motion.div>

            {/* Counterparties */}
            <motion.div variants={fadeUp}>
              <CounterpartyPanel />
            </motion.div>
          </div>
        </motion.main>
      </div>

      <AnimatePresence>
        {showAddDialog && <AddWalletDialog onClose={() => setShowAddDialog(false)} />}
      </AnimatePresence>
    </div>
  );
}

// ─── WalletList ─────────────────────────────────────────────────────

function WalletList() {
  const { data: wallets, isLoading, error } = useQuery({
    queryKey: ['wallets'],
    queryFn: listWallets,
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <div className="rounded-2xl bg-surface/60 backdrop-blur-md border border-white/[0.06] p-12 flex flex-col items-center justify-center shadow-lg shadow-black/20">
        <Loader2 className="w-6 h-6 text-primary/50 animate-spin mb-3" />
        <p className="text-sm text-white/30">Loading wallets...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-surface/60 backdrop-blur-md border border-red-500/20 p-8 flex flex-col items-center text-center shadow-lg shadow-black/20">
        <AlertTriangle className="w-6 h-6 text-red-400 mb-3" />
        <p className="text-sm text-white/60 mb-1">Failed to load wallets</p>
        <p className="text-xs text-white/25">{(error as Error).message}</p>
      </div>
    );
  }

  if (!wallets?.length) {
    return (
      <div className="rounded-2xl bg-surface/60 backdrop-blur-md border border-white/[0.06] p-12 flex flex-col items-center text-center shadow-lg shadow-black/20">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/15 to-blue-500/5 flex items-center justify-center border border-blue-500/10 mb-4">
          <Wallet className="w-8 h-8 text-blue-400/50" />
        </div>
        <h3 className="font-display text-lg font-bold text-white/60 mb-1">No wallets connected</h3>
        <p className="text-sm text-white/25 max-w-sm">
          Add a Solana wallet address to start indexing transactions and generating tax reports.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {wallets.map((wallet) => (
        <WalletCard key={wallet.id} wallet={wallet} />
      ))}
    </div>
  );
}

// ─── WalletCard ─────────────────────────────────────────────────────

function WalletCard({ wallet }: { wallet: WalletType }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: syncStatus } = useQuery({
    queryKey: ['sync-status', wallet.id],
    queryFn: () => getSyncStatus(wallet.id),
    refetchInterval: (query) => {
      const data = query.state.data as SyncStatus | undefined;
      return data?.status === 'SYNCING' ? 3000 : 30000;
    },
    enabled: !!wallet.id,
  });

  const syncMutation = useMutation({
    mutationFn: () => syncWallet(wallet.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sync-status', wallet.id] }),
  });

  const removeMutation = useMutation({
    mutationFn: () => deleteWallet(wallet.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wallets'] }),
  });

  const truncated = `${wallet.address.slice(0, 6)}...${wallet.address.slice(-6)}`;

  const copyAddress = () => {
    navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isSyncing = syncStatus?.status === 'SYNCING';

  return (
    <div className={`relative rounded-2xl bg-surface/60 backdrop-blur-md border overflow-hidden transition-all shadow-lg shadow-black/20 group ${
      isSyncing ? 'border-primary/20' : 'border-white/[0.06] hover:border-white/[0.12]'
    }`}>
      {/* Top accent line */}
      <div className={`absolute top-0 left-6 right-6 h-[1px] bg-gradient-to-r from-transparent ${
        isSyncing ? 'via-primary/40' : 'via-blue-500/15'
      } to-transparent`} />

      {/* Main row */}
      <div className="px-6 py-5">
        <div className="flex items-center gap-4">
          {/* Icon */}
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border ${
            isSyncing
              ? 'bg-gradient-to-br from-primary/20 to-primary/5 border-primary/15'
              : 'bg-gradient-to-br from-blue-500/15 to-blue-500/5 border-blue-500/10'
          }`}>
            <Wallet className={`w-6 h-6 ${isSyncing ? 'text-primary' : 'text-blue-400'}`} />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-base font-semibold text-white truncate">
                {wallet.label || 'Wallet'}
              </h3>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/[0.04] text-white/25 uppercase border border-white/[0.04]">
                {wallet.network.replace('-beta', '')}
              </span>
              {!wallet.isActive && (
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/10">
                  Inactive
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono text-white/35">{truncated}</span>
              <button onClick={copyAddress} className="text-white/15 hover:text-white/40 transition-colors">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <a
                href={`https://solscan.io/account/${wallet.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/15 hover:text-white/40 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {/* Stats */}
          <div className="hidden sm:flex items-center gap-5">
            <div className="text-right">
              <div className="flex items-center gap-1.5 justify-end mb-0.5">
                <Activity className="w-3 h-3 text-white/15" />
                <p className="text-[10px] text-white/25 uppercase tracking-wider font-medium">Transactions</p>
              </div>
              <p className="text-lg font-display font-bold text-white">{wallet.transactionCount.toLocaleString()}</p>
            </div>
            <div className="w-px h-10 bg-white/[0.04]" />
            <div className="text-right">
              <div className="flex items-center gap-1.5 justify-end mb-0.5">
                <Calendar className="w-3 h-3 text-white/15" />
                <p className="text-[10px] text-white/25 uppercase tracking-wider font-medium">Last sync</p>
              </div>
              <p className="text-sm text-white/45 font-mono">
                {wallet.lastTransactionAt
                  ? new Date(wallet.lastTransactionAt).toLocaleDateString()
                  : '—'}
              </p>
            </div>
          </div>

          {/* Sync status badge */}
          <SyncBadge status={syncStatus} />

          {/* Actions */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending || isSyncing}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                isSyncing
                  ? 'bg-primary/10 text-primary'
                  : 'bg-white/[0.03] text-white/15 hover:text-primary hover:bg-primary/10'
              }`}
              title="Sync wallet"
            >
              {syncMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              )}
            </button>
            <button
              onClick={() => removeMutation.mutate()}
              disabled={removeMutation.isPending}
              className="w-9 h-9 rounded-lg bg-white/[0.03] flex items-center justify-center text-white/15 hover:text-red-400 hover:bg-red-500/10 transition-all"
              title="Disconnect wallet"
            >
              {removeMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-9 h-9 rounded-lg bg-white/[0.03] flex items-center justify-center text-white/15 hover:text-white/40 transition-all"
            >
              <motion.div animate={{ rotate: expanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
                <ChevronRight className="w-4 h-4" />
              </motion.div>
            </button>
          </div>
        </div>

        {/* Sync progress */}
        {isSyncing && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-white/30">Indexing transactions...</span>
              <span className="text-[11px] font-mono text-primary">
                {syncStatus!.totalTransactionsIndexed.toLocaleString()} synced
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
              <div className="h-full w-1/3 bg-gradient-to-r from-primary/80 to-primary rounded-full animate-indeterminate" />
            </div>
          </div>
        )}
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-6 py-4 border-t border-white/[0.04] bg-white/[0.01]">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <DetailItem label="Network" value={wallet.network.replace('-beta', '')} icon={<Globe className="w-3 h-3 text-white/15" />} />
                <DetailItem label="Active" value={wallet.isActive ? 'Yes' : 'No'} icon={<CheckCircle2 className="w-3 h-3 text-white/15" />} />
                <DetailItem
                  label="First Tx"
                  value={wallet.firstTransactionAt ? new Date(wallet.firstTransactionAt).toLocaleDateString() : '—'}
                  icon={<Calendar className="w-3 h-3 text-white/15" />}
                />
                <DetailItem
                  label="Connected"
                  value={new Date(wallet.createdAt).toLocaleDateString()}
                  icon={<Link2 className="w-3 h-3 text-white/15" />}
                />
              </div>
              {syncStatus?.status === 'FAILED' && syncStatus.errorMessage && (
                <div className="mt-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-red-400 mb-0.5">Sync failed</p>
                    <p className="text-xs text-red-400/60">{syncStatus.errorMessage}</p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DetailItem({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="px-3 py-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <p className="text-[10px] text-white/25 uppercase tracking-wider font-medium">{label}</p>
      </div>
      <p className="text-sm text-white/60 font-mono">{value}</p>
    </div>
  );
}

// ─── SyncBadge ──────────────────────────────────────────────────────

function SyncBadge({ status }: { status: SyncStatus | undefined }) {
  if (!status) {
    return (
      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] text-[11px] text-white/25 border border-white/[0.04]">
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading
      </span>
    );
  }

  const config: Record<SyncStatus['status'], { icon: typeof Check; label: string; color: string; bg: string; border: string }> = {
    IDLE: { icon: Pause, label: 'Idle', color: 'text-white/30', bg: 'bg-white/[0.04]', border: 'border-white/[0.04]' },
    SYNCING: { icon: RefreshCw, label: 'Syncing', color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/15' },
    COMPLETED: { icon: CheckCircle2, label: 'Synced', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/15' },
    FAILED: { icon: AlertTriangle, label: 'Failed', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/15' },
    PAUSED: { icon: Pause, label: 'Paused', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/15' },
  };

  const c = config[status.status];
  const Icon = c.icon;

  return (
    <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${c.bg} ${c.color} text-[11px] font-medium border ${c.border}`}>
      <Icon className={`w-3 h-3 ${status.status === 'SYNCING' ? 'animate-spin' : ''}`} />
      {c.label}
    </span>
  );
}

// ─── CounterpartyPanel ──────────────────────────────────────────────

function CounterpartyPanel() {
  const queryClient = useQueryClient();

  const { data: counterparties, isLoading } = useQuery({
    queryKey: ['counterparties'],
    queryFn: () => getCounterpartySuggestions(2),
  });

  const claimMutation = useMutation({
    mutationFn: (id: string) => claimCounterparty(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallets'] });
      queryClient.invalidateQueries({ queryKey: ['counterparties'] });
    },
  });

  const entityTypeLabels: Record<string, { label: string; color: string; border: string }> = {
    EXCHANGE: { label: 'Exchange', color: 'text-blue-400 bg-blue-500/10', border: 'border-blue-500/10' },
    DEX: { label: 'DEX', color: 'text-violet-400 bg-violet-500/10', border: 'border-violet-500/10' },
    DEFI_PROTOCOL: { label: 'DeFi', color: 'text-emerald-400 bg-emerald-500/10', border: 'border-emerald-500/10' },
    NFT_MARKETPLACE: { label: 'NFT', color: 'text-pink-400 bg-pink-500/10', border: 'border-pink-500/10' },
    PERSONAL: { label: 'Personal', color: 'text-amber-400 bg-amber-500/10', border: 'border-amber-500/10' },
    BUSINESS: { label: 'Business', color: 'text-cyan-400 bg-cyan-500/10', border: 'border-cyan-500/10' },
    UNKNOWN: { label: 'Unknown', color: 'text-white/30 bg-white/[0.04]', border: 'border-white/[0.04]' },
  };

  return (
    <div className="rounded-2xl bg-surface/60 backdrop-blur-md border border-white/[0.06] overflow-hidden shadow-lg shadow-black/20">
      <div className="px-5 py-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500/15 to-violet-500/5 flex items-center justify-center border border-violet-500/10">
            <Ghost className="w-4.5 h-4.5 text-violet-400" />
          </div>
          <div>
            <h2 className="font-display text-[15px] font-bold text-white">Ghost Wallets</h2>
            <p className="text-[11px] text-white/25">Frequent counterparties</p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 flex justify-center">
          <Loader2 className="w-5 h-5 text-white/20 animate-spin" />
        </div>
      ) : !counterparties?.length ? (
        <div className="p-8 text-center">
          <Ghost className="w-8 h-8 text-white/10 mx-auto mb-3" />
          <p className="text-sm text-white/30">No counterparties found yet.</p>
          <p className="text-xs text-white/15 mt-1">
            Connect a wallet and index transactions to discover frequent counterparties.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-white/[0.03]">
          {counterparties.map((cp) => {
            const truncated = `${cp.address.slice(0, 6)}...${cp.address.slice(-4)}`;
            const entityInfo = entityTypeLabels[cp.entityType ?? 'UNKNOWN'] ?? entityTypeLabels.UNKNOWN;

            return (
              <div key={cp.id} className="px-5 py-4 hover:bg-white/[0.015] transition-colors">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center shrink-0 border border-white/[0.04]">
                    <Users className="w-4 h-4 text-white/25" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-mono text-white/55 truncate">{truncated}</span>
                      {cp.label && (
                        <span className="flex items-center gap-1 text-[10px] text-white/30">
                          <Tag className="w-2.5 h-2.5" />
                          {cp.label}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium border ${entityInfo.color} ${entityInfo.border}`}>
                        {entityInfo.label}
                      </span>
                      <span className="flex items-center gap-1 text-[11px] text-white/25">
                        <ArrowLeftRight className="w-3 h-3" />
                        {cp.interactionCount} interactions
                      </span>
                    </div>
                  </div>
                  {!cp.isKnownProgram && (
                    <button
                      onClick={() => claimMutation.mutate(cp.id)}
                      disabled={claimMutation.isPending}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-[11px] font-semibold hover:bg-primary/20 transition-colors disabled:opacity-50 border border-primary/10"
                    >
                      {claimMutation.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Link2 className="w-3 h-3" />
                      )}
                      Claim
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── AddWalletDialog ────────────────────────────────────────────────

function AddWalletDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => createWallet({ address, label: label || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallets'] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!address.trim()) { setError('Wallet address is required'); return; }
    if (address.trim().length < 32 || address.trim().length > 44) { setError('Invalid Solana address'); return; }
    mutation.mutate();
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
        <div className="w-full max-w-md bg-surface border border-white/[0.06] rounded-2xl overflow-hidden shadow-2xl shadow-black/40">
          <div className="px-6 py-5 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/10">
                <Plus className="w-5 h-5 text-primary" />
              </div>
              <h2 className="font-display text-lg font-bold text-white">Add Wallet</h2>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white/30 hover:text-white hover:bg-white/10 transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-xs text-white/40 mb-2 uppercase tracking-wider font-medium">
                Solana Address
              </label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2"><Wallet className="w-4 h-4 text-white/15" /></div>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Enter Solana wallet address..."
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] text-sm text-white/80 font-mono placeholder-white/20 focus:outline-none focus:border-primary/30 focus:bg-white/[0.06] transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-white/40 mb-2 uppercase tracking-wider font-medium">
                Label <span className="text-white/15">(optional)</span>
              </label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2"><Tag className="w-4 h-4 text-white/15" /></div>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Trading Wallet, Cold Storage..."
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] text-sm text-white/80 placeholder-white/20 focus:outline-none focus:border-primary/30 focus:bg-white/[0.06] transition-all"
                />
              </div>
            </div>

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
                disabled={mutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-background text-sm font-semibold hover:bg-primary-400 transition-all disabled:opacity-50 shadow-lg shadow-primary/10"
              >
                {mutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                Connect Wallet
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </>
  );
}
