'use client';

import { Check, Wallet, Globe, ChevronLeft, ArrowRight, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/contexts/AuthContext';
import { updateUserPreferences } from '@/lib/api';
import { JURISDICTIONS } from '@/lib/constants';
import { useState } from 'react';
import { motion } from 'framer-motion';

interface OnboardingSummaryStepProps {
  selectedJurisdiction: string | null;
  onComplete: () => void;
  onBack: () => void;
}

export function OnboardingSummaryStep({ selectedJurisdiction, onComplete, onBack }: OnboardingSummaryStepProps) {
  const router = useRouter();
  const { user } = useAuthContext();
  const [isSaving, setIsSaving] = useState(false);

  const jurisdiction = JURISDICTIONS.find((j) => j.code === selectedJurisdiction);

  const handleGoToDashboard = async () => {
    if (!selectedJurisdiction) return;
    setIsSaving(true);
    try {
      await updateUserPreferences({ defaultJurisdiction: selectedJurisdiction });
      onComplete();
      router.push('/dashboard');
    } catch {
      onComplete();
      router.push('/dashboard');
    } finally {
      setIsSaving(false);
    }
  };

  const truncatedWallet = user?.walletAddress
    ? `${user.walletAddress.slice(0, 4)}...${user.walletAddress.slice(-4)}`
    : 'Connected';

  return (
    <div className="max-w-md mx-auto text-center">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <span className="font-mono text-[11px] text-primary uppercase tracking-wider">
          // all set
        </span>
        <h2 className="font-display text-2xl font-bold mt-2 mb-2">
          Ready to get compliant
        </h2>
        <p className="text-sm text-gray-500 mb-8">
          Confirm your setup and head to the dashboard.
        </p>

        {/* Checklist */}
        <div className="space-y-3 text-left mb-8">
          <div className="flex items-center gap-3 p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
            <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
              <Wallet className="w-4 h-4 text-green-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Wallet connected</p>
              <p className="text-[11px] text-gray-600 font-mono">{truncatedWallet}</p>
            </div>
            <Check className="w-4 h-4 text-green-400 shrink-0" />
          </div>

          <div className="flex items-center gap-3 p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
            <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
              <Globe className="w-4 h-4 text-green-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Jurisdiction</p>
              <p className="text-[11px] text-gray-600">
                {jurisdiction ? `${jurisdiction.flag} ${jurisdiction.name}` : 'Not selected'}
              </p>
            </div>
            {selectedJurisdiction && <Check className="w-4 h-4 text-green-400 shrink-0" />}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-gray-500 hover:text-white transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Change
          </button>
          <button
            onClick={handleGoToDashboard}
            disabled={!selectedJurisdiction || isSaving}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-primary text-background font-semibold rounded-xl hover:bg-primary-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                Go to Dashboard
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
