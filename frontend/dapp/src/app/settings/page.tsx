'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { redirect } from 'next/navigation';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings,
  Globe,
  Calculator,
  ToggleLeft,
  ToggleRight,
  Loader2,
  AlertTriangle,
  Check,
  Save,
} from 'lucide-react';
import { Navbar } from '@/components/dashboard/Sidebar';
import { getMe, updateUserPreferences } from '@/lib/api';

const container = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.08 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] } },
};

const JURISDICTIONS = [
  { code: 'US', name: 'United States', flag: '\u{1F1FA}\u{1F1F8}' },
  { code: 'EU', name: 'European Union', flag: '\u{1F1EA}\u{1F1FA}' },
  { code: 'BR', name: 'Brazil', flag: '\u{1F1E7}\u{1F1F7}' },
];

const COST_BASIS_METHODS = [
  { value: 'FIFO', label: 'FIFO', description: 'First In, First Out \u2014 sells oldest assets first' },
  { value: 'LIFO', label: 'LIFO', description: 'Last In, First Out \u2014 sells newest assets first' },
  { value: 'HIFO', label: 'HIFO', description: 'Highest In, First Out \u2014 most tax efficient' },
  { value: 'AVERAGE', label: 'Average', description: 'Average cost basis across all lots' },
];

export default function SettingsPage() {
  const { connected, publicKey } = useWallet();
  const queryClient = useQueryClient();

  const [jurisdiction, setJurisdiction] = useState('');
  const [costBasis, setCostBasis] = useState('FIFO');
  const [includeStaking, setIncludeStaking] = useState(true);
  const [includeAirdrops, setIncludeAirdrops] = useState(true);
  const [includeNFTs, setIncludeNFTs] = useState(true);
  const [includeDeFi, setIncludeDeFi] = useState(true);
  const [includeFees, setIncludeFees] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!connected) redirect('/');
  }, [connected]);

  const { data: user, isLoading, error } = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
  });

  // Initialize form from user data
  useEffect(() => {
    if (user?.defaultJurisdiction) {
      setJurisdiction(user.defaultJurisdiction);
    }
  }, [user]);

  const saveMutation = useMutation({
    mutationFn: () =>
      updateUserPreferences({ defaultJurisdiction: jurisdiction }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const updateField = <T,>(setter: (v: T) => void) => (value: T) => {
    setter(value);
    setDirty(true);
  };

  if (!connected || !publicKey) return null;

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
          className="max-w-3xl mx-auto p-5 lg:px-8 lg:py-8 space-y-6"
        >
          {/* Header */}
          <motion.div variants={fadeUp} className="flex items-center justify-between">
            <div>
              <h1 className="font-display text-2xl font-bold text-white">Settings</h1>
              <p className="text-sm text-white/30 mt-1">
                Configure default audit preferences
              </p>
            </div>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={!dirty || saveMutation.isPending}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-background text-sm font-semibold hover:bg-primary-400 transition-all hover:scale-[1.02] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {saveMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : saved ? (
                <Check className="w-4 h-4" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {saved ? 'Saved' : 'Save Changes'}
            </button>
          </motion.div>

          {isLoading ? (
            <motion.div variants={fadeUp} className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 p-12 flex flex-col items-center">
              <Loader2 className="w-6 h-6 text-primary/50 animate-spin mb-3" />
              <p className="text-sm text-white/30">Loading settings...</p>
            </motion.div>
          ) : error ? (
            <motion.div variants={fadeUp} className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-red-500/20 p-8 flex flex-col items-center text-center">
              <AlertTriangle className="w-6 h-6 text-red-400 mb-3" />
              <p className="text-sm text-white/60 mb-1">Failed to load settings</p>
              <p className="text-xs text-white/25">{(error as Error).message}</p>
            </motion.div>
          ) : (
            <>
              {/* Default Jurisdiction */}
              <motion.div variants={fadeUp} className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 overflow-hidden">
                <div className="px-6 py-5 border-b border-white/5 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Globe className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="font-display text-lg font-bold text-white">Default Jurisdiction</h2>
                    <p className="text-xs text-white/30">Tax rules applied to new audits</p>
                  </div>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {JURISDICTIONS.map((j) => (
                      <button
                        key={j.code}
                        onClick={() => updateField(setJurisdiction)(j.code)}
                        className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                          jurisdiction === j.code
                            ? 'border-primary bg-primary/5'
                            : 'border-white/5 hover:border-white/10 bg-white/[0.02]'
                        }`}
                      >
                        <div className="text-2xl mb-2">{j.flag}</div>
                        <div className="text-sm font-semibold text-white/80">{j.name}</div>
                        <div className="text-xs text-white/30 mt-0.5">{j.code}</div>
                        {jurisdiction === j.code && (
                          <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                            <Check className="w-3 h-3 text-background" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>

              {/* Cost Basis Method */}
              <motion.div variants={fadeUp} className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 overflow-hidden">
                <div className="px-6 py-5 border-b border-white/5 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Calculator className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="font-display text-lg font-bold text-white">Cost Basis Method</h2>
                    <p className="text-xs text-white/30">How gains/losses are calculated on disposals</p>
                  </div>
                </div>
                <div className="p-6 space-y-2">
                  {COST_BASIS_METHODS.map((method) => (
                    <button
                      key={method.value}
                      onClick={() => updateField(setCostBasis)(method.value)}
                      className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-left ${
                        costBasis === method.value
                          ? 'border-primary bg-primary/5'
                          : 'border-white/5 hover:border-white/10 bg-white/[0.02]'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        costBasis === method.value ? 'border-primary' : 'border-white/20'
                      }`}>
                        {costBasis === method.value && (
                          <div className="w-2 h-2 rounded-full bg-primary" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white/80">{method.label}</p>
                        <p className="text-xs text-white/30 mt-0.5">{method.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>

              {/* Inclusions */}
              <motion.div variants={fadeUp} className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 overflow-hidden">
                <div className="px-6 py-5 border-b border-white/5 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Settings className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="font-display text-lg font-bold text-white">Default Inclusions</h2>
                    <p className="text-xs text-white/30">Transaction types included in new audits</p>
                  </div>
                </div>
                <div className="p-6 space-y-1">
                  <ToggleRow
                    label="Staking Rewards"
                    description="Include staking and liquid staking income"
                    enabled={includeStaking}
                    onToggle={() => updateField(setIncludeStaking)(!includeStaking)}
                  />
                  <ToggleRow
                    label="Airdrops"
                    description="Include airdrop income events"
                    enabled={includeAirdrops}
                    onToggle={() => updateField(setIncludeAirdrops)(!includeAirdrops)}
                  />
                  <ToggleRow
                    label="NFT Transactions"
                    description="Include NFT buys, sells, and mints"
                    enabled={includeNFTs}
                    onToggle={() => updateField(setIncludeNFTs)(!includeNFTs)}
                  />
                  <ToggleRow
                    label="DeFi Interactions"
                    description="Include LP, lending, and borrowing"
                    enabled={includeDeFi}
                    onToggle={() => updateField(setIncludeDeFi)(!includeDeFi)}
                  />
                  <ToggleRow
                    label="Transaction Fees"
                    description="Include gas/priority fees as deductible expenses"
                    enabled={includeFees}
                    onToggle={() => updateField(setIncludeFees)(!includeFees)}
                  />
                </div>
              </motion.div>

              {/* Save error */}
              {saveMutation.isError && (
                <motion.div variants={fadeUp} className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  <p className="text-xs text-red-400">{(saveMutation.error as Error).message}</p>
                </motion.div>
              )}
            </>
          )}
        </motion.main>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  enabled,
  onToggle,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between gap-4 px-4 py-3.5 rounded-xl hover:bg-white/[0.02] transition-colors text-left"
    >
      <div>
        <p className="text-sm font-medium text-white/70">{label}</p>
        <p className="text-xs text-white/25 mt-0.5">{description}</p>
      </div>
      {enabled ? (
        <ToggleRight className="w-6 h-6 text-primary shrink-0" />
      ) : (
        <ToggleLeft className="w-6 h-6 text-white/20 shrink-0" />
      )}
    </button>
  );
}
