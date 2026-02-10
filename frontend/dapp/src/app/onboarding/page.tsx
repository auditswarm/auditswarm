'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/contexts/AuthContext';
import { useOnboardingStore } from '@/stores/useOnboardingStore';
import { Logo } from '@/components/ui';
import { HoneycombBackground } from '@/components/visuals/HoneycombBackground';
import { RegionSelectStep } from '@/components/onboarding/RegionSelectStep';
import { OnboardingSummaryStep } from '@/components/onboarding/OnboardingSummaryStep';
import { Check } from 'lucide-react';

const STEPS = [
  { label: 'Jurisdiction' },
  { label: 'Confirm' },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, user } = useAuthContext();
  const {
    currentStep,
    selectedJurisdiction,
    nextStep,
    prevStep,
    selectJurisdiction,
    completeOnboarding,
  } = useOnboardingStore();

  const [displayStep, setDisplayStep] = useState(currentStep);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/');
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated && user?.defaultJurisdiction) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, user, router]);

  useEffect(() => {
    setDisplayStep(currentStep);
  }, [currentStep]);

  const truncatedWallet = user?.walletAddress
    ? `${user.walletAddress.slice(0, 4)}...${user.walletAddress.slice(-4)}`
    : '';

  if (isLoading || !isAuthenticated) return null;

  return (
    <HoneycombBackground>
      <div className="h-screen flex flex-col overflow-hidden">
        {/* ─── HEADER ─── */}
        <header className="shrink-0 border-b border-white/[0.06] bg-background/70 backdrop-blur-md z-50">
          <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-6">
            {/* Logo */}
            <div className="flex items-center gap-2 shrink-0">
              <Logo size={20} className="text-primary" />
              <span className="text-sm font-semibold tracking-tight hidden sm:inline">
                Audit<span className="text-primary">Swarm</span>
              </span>
            </div>

            {/* Steps */}
            <nav className="flex-1 flex items-center justify-center">
              <div className="flex items-center gap-1">
                {STEPS.map((step, i) => {
                  const isActive = i === currentStep;
                  const isDone = i < currentStep;
                  return (
                    <div key={step.label} className="flex items-center">
                      {i > 0 && (
                        <div
                          className={`w-10 h-px mx-2 transition-colors duration-300 ${
                            isDone ? 'bg-primary/50' : 'bg-white/[0.06]'
                          }`}
                        />
                      )}
                      <div className="flex items-center gap-2">
                        <div
                          className={`
                            w-6 h-6 rounded-full text-[10px] font-semibold flex items-center justify-center transition-all duration-300
                            ${
                              isActive
                                ? 'bg-primary text-background'
                                : isDone
                                  ? 'bg-primary/20 text-primary'
                                  : 'bg-white/[0.06] text-gray-600'
                            }
                          `}
                        >
                          {isDone ? <Check className="w-3 h-3" strokeWidth={3} /> : i + 1}
                        </div>
                        <span
                          className={`text-xs font-medium transition-colors duration-300 ${
                            isActive ? 'text-white' : isDone ? 'text-primary/70' : 'text-gray-600'
                          }`}
                        >
                          {step.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </nav>

            {/* Wallet */}
            {truncatedWallet && (
              <span className="font-mono text-[11px] text-gray-600 shrink-0">
                {truncatedWallet}
              </span>
            )}
          </div>
        </header>

        {/* ─── CONTENT ─── */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-6 py-10">
            {displayStep === 0 && (
              <RegionSelectStep
                selectedJurisdiction={selectedJurisdiction}
                onSelect={(code) => {
                  selectJurisdiction(code);
                  nextStep();
                }}
              />
            )}
            {displayStep === 1 && (
              <OnboardingSummaryStep
                selectedJurisdiction={selectedJurisdiction}
                onComplete={completeOnboarding}
                onBack={prevStep}
              />
            )}
          </div>
        </main>
      </div>
    </HoneycombBackground>
  );
}
