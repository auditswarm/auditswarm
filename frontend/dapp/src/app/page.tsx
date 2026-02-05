'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { redirect } from 'next/navigation';
import { useEffect } from 'react';
import { Shield, Zap, Globe, FileCheck } from 'lucide-react';

export default function Home() {
  const { connected } = useWallet();

  useEffect(() => {
    if (connected) {
      redirect('/dashboard');
    }
  }, [connected]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
      {/* Hero Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
        <div className="text-center">
          <h1 className="text-5xl font-bold text-gray-900 dark:text-white mb-6">
            <span className="text-primary-500">Audit</span>Swarm
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto mb-8">
            AI-powered crypto tax compliance with jurisdiction-specific bees
            and on-chain attestations.
          </p>
          <div className="flex justify-center gap-4">
            <WalletMultiButton />
          </div>
        </div>

        {/* Features Grid */}
        <div className="mt-24 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <FeatureCard
            icon={<Shield className="w-8 h-8 text-primary-500" />}
            title="On-Chain Attestations"
            description="Permanent, verifiable proof of tax compliance stored on Solana"
          />
          <FeatureCard
            icon={<Globe className="w-8 h-8 text-primary-500" />}
            title="Multi-Jurisdiction"
            description="Specialized AI agents for US, EU, and Brazil tax regulations"
          />
          <FeatureCard
            icon={<Zap className="w-8 h-8 text-primary-500" />}
            title="AI-Powered Analysis"
            description="Advanced LLM agents analyze your transactions and optimize taxes"
          />
          <FeatureCard
            icon={<FileCheck className="w-8 h-8 text-primary-500" />}
            title="Official Reports"
            description="Generate Form 8949, Schedule D, IN 1888, and more"
          />
        </div>

        {/* Supported Jurisdictions */}
        <div className="mt-24">
          <h2 className="text-2xl font-bold text-center text-gray-900 dark:text-white mb-8">
            Supported Jurisdictions
          </h2>
          <div className="flex justify-center gap-8">
            <JurisdictionBadge code="US" name="United States" active />
            <JurisdictionBadge code="EU" name="European Union" active />
            <JurisdictionBadge code="BR" name="Brazil" active />
            <JurisdictionBadge code="UK" name="United Kingdom" />
            <JurisdictionBadge code="JP" name="Japan" />
          </div>
        </div>

        {/* CTA */}
        <div className="mt-24 text-center">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
            Ready to get compliant?
          </h2>
          <p className="text-gray-600 dark:text-gray-300 mb-8">
            Connect your wallet to start your first audit.
          </p>
          <WalletMultiButton />
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-700 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center text-gray-500">
          <p>Built for Colosseum Agent Hackathon 2024</p>
          <p className="mt-2">Powered by Solana, Claude, and LangGraph</p>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="p-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
      <div className="mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        {title}
      </h3>
      <p className="text-gray-600 dark:text-gray-300">{description}</p>
    </div>
  );
}

function JurisdictionBadge({
  code,
  name,
  active,
}: {
  code: string;
  name: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center ${
        active ? 'opacity-100' : 'opacity-50'
      }`}
    >
      <div
        className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold ${
          active
            ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300'
            : 'bg-gray-100 text-gray-400 dark:bg-gray-800'
        }`}
      >
        {code}
      </div>
      <span className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        {name}
      </span>
      {!active && (
        <span className="text-xs text-gray-400">Coming Soon</span>
      )}
    </div>
  );
}
