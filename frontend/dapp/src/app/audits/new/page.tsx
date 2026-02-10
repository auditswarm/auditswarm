'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { redirect, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { createAudit, listWallets, type CreateAuditDto } from '@/lib/api';

const JURISDICTIONS = [
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'EU', name: 'European Union', flag: '🇪🇺' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
];

const COST_BASIS_METHODS = [
  { value: 'FIFO', label: 'FIFO (First In, First Out)', description: 'Sells oldest assets first' },
  { value: 'LIFO', label: 'LIFO (Last In, First Out)', description: 'Sells newest assets first' },
  { value: 'HIFO', label: 'HIFO (Highest In, First Out)', description: 'Sells highest cost assets first (tax efficient)' },
];

export default function NewAuditPage() {
  const { connected, publicKey } = useWallet();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [jurisdiction, setJurisdiction] = useState('');
  const [taxYear, setTaxYear] = useState(new Date().getFullYear());
  const [costBasisMethod, setCostBasisMethod] = useState('FIFO');
  const [includeStaking, setIncludeStaking] = useState(true);
  const [includeAirdrops, setIncludeAirdrops] = useState(true);
  const [includeNFTs, setIncludeNFTs] = useState(true);

  if (!connected) {
    redirect('/');
  }

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      // Get user's wallets to include in audit
      const wallets = await listWallets();
      if (wallets.length === 0) {
        setError('No wallets found. Please add a wallet first.');
        return;
      }

      const dto: CreateAuditDto = {
        walletIds: wallets.map(w => w.id),
        jurisdiction: jurisdiction as 'US' | 'EU' | 'BR',
        type: 'FULL_TAX_YEAR',
        taxYear,
        options: {
          costBasisMethod: costBasisMethod as 'FIFO' | 'LIFO' | 'HIFO',
          includeStaking,
          includeAirdrops,
          includeNFTs,
          includeDeFi: true,
          includeFees: true,
          currency: jurisdiction === 'BR' ? 'BRL' : jurisdiction === 'EU' ? 'EUR' : 'USD',
        },
      };

      await createAudit(dto);
      router.push('/audits');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create audit';
      setError(message);
      console.error('Failed to create audit:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Request New Audit
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mb-8">
          Configure your tax compliance audit settings
        </p>

        {/* Progress Steps */}
        <div className="flex items-center gap-4 mb-8">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  s <= step
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
                }`}
              >
                {s}
              </div>
              {s < 3 && (
                <div
                  className={`w-16 h-1 mx-2 ${
                    s < step ? 'bg-primary-500' : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Jurisdiction */}
        {step === 1 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Select Jurisdiction
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              Choose the tax jurisdiction for your audit. Each jurisdiction has
              specialized compliance bees with region-specific tax rules.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {JURISDICTIONS.map((j) => (
                <button
                  key={j.code}
                  onClick={() => setJurisdiction(j.code)}
                  className={`p-6 rounded-xl border-2 text-left transition-all ${
                    jurisdiction === j.code
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                  }`}
                >
                  <div className="text-3xl mb-2">{j.flag}</div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    {j.name}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {j.code}
                  </div>
                </button>
              ))}
            </div>
            <div className="flex justify-end mt-6">
              <button
                onClick={() => setStep(2)}
                disabled={!jurisdiction}
                className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 disabled:bg-gray-300 text-white px-6 py-2 rounded-lg font-medium transition-colors"
              >
                Continue
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Tax Year */}
        {step === 2 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Select Tax Year
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              Choose the tax year you want to audit.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {[2024, 2023, 2022, 2021].map((year) => (
                <button
                  key={year}
                  onClick={() => setTaxYear(year)}
                  className={`p-4 rounded-xl border-2 text-center font-medium transition-all ${
                    taxYear === year
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                      : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300'
                  }`}
                >
                  {year}
                </button>
              ))}
            </div>
            <div className="flex justify-between mt-6">
              <button
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-gray-900"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-6 py-2 rounded-lg font-medium transition-colors"
              >
                Continue
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Options */}
        {step === 3 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Audit Options
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              Customize your audit settings.
            </p>

            {/* Cost Basis Method */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Cost Basis Method
              </label>
              <div className="space-y-3">
                {COST_BASIS_METHODS.map((method) => (
                  <label
                    key={method.value}
                    className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      costBasisMethod === method.value
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="costBasis"
                      value={method.value}
                      checked={costBasisMethod === method.value}
                      onChange={(e) => setCostBasisMethod(e.target.value)}
                      className="mt-1"
                    />
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">
                        {method.label}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {method.description}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Include Options */}
            <div className="space-y-4 mb-6">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={includeStaking}
                  onChange={(e) => setIncludeStaking(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-gray-700 dark:text-gray-300">
                  Include staking rewards
                </span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={includeAirdrops}
                  onChange={(e) => setIncludeAirdrops(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-gray-700 dark:text-gray-300">
                  Include airdrops
                </span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={includeNFTs}
                  onChange={(e) => setIncludeNFTs(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-gray-700 dark:text-gray-300">
                  Include NFT transactions
                </span>
              </label>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-6">
                <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
              </div>
            )}

            {/* Summary */}
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 mb-6">
              <h3 className="font-medium text-gray-900 dark:text-white mb-2">
                Audit Summary
              </h3>
              <ul className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
                <li>Jurisdiction: {JURISDICTIONS.find(j => j.code === jurisdiction)?.name}</li>
                <li>Tax Year: {taxYear}</li>
                <li>Cost Basis: {costBasisMethod}</li>
                <li>Wallet: {publicKey?.toBase58().slice(0, 8)}...</li>
              </ul>
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-gray-900"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 disabled:bg-primary-400 text-white px-6 py-2 rounded-lg font-medium transition-colors"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    Request Audit
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
