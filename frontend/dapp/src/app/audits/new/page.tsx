'use client';

import { useState, useMemo, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { redirect, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  CheckCircle2,
  Shield,
  Calculator,
  FileCheck,
  ChevronRight,
} from 'lucide-react';
import { Navbar } from '@/components/dashboard/Sidebar';
import { createAudit, listWallets, type CreateAuditDto } from '@/lib/api';

/* ─── Jurisdiction config ────────────────────────────────────────────── */

const JURISDICTIONS = [
  {
    code: 'US',
    name: 'United States',
    flag: '\u{1F1FA}\u{1F1F8}',
    description: 'IRS Form 8949, Schedule D, FBAR compliance',
    costBasisMethods: [
      { value: 'FIFO', label: 'FIFO (First In, First Out)', description: 'Sells oldest assets first — IRS default' },
      { value: 'LIFO', label: 'LIFO (Last In, First Out)', description: 'Sells newest assets first' },
      { value: 'HIFO', label: 'HIFO (Highest In, First Out)', description: 'Sells highest cost first — most tax efficient' },
      { value: 'SPECIFIC_ID', label: 'Specific Identification', description: 'Choose which lots to sell — maximum control' },
    ],
    currency: 'USD',
    extraOptions: [
      { key: 'includeFBAR', label: 'FBAR Foreign Account Check', description: 'Check for $10,000+ foreign exchange account reporting (FinCEN 114)', default: true },
      { key: 'includeWashSale', label: 'Wash Sale Detection', description: 'Flag 30-day repurchases (IRS guidance pending)', default: false },
    ],
  },
  {
    code: 'EU',
    name: 'European Union',
    flag: '\u{1F1EA}\u{1F1FA}',
    description: 'DAC8 reporting, MiCA classification, capital gains',
    costBasisMethods: [
      { value: 'FIFO', label: 'FIFO (First In, First Out)', description: 'Most common in EU jurisdictions' },
      { value: 'AVERAGE', label: 'Average Cost', description: 'Weighted average cost basis — used in some member states' },
      { value: 'LIFO', label: 'LIFO (Last In, First Out)', description: 'Sells newest assets first' },
    ],
    currency: 'EUR',
    extraOptions: [
      { key: 'includeMiCA', label: 'MiCA Classification', description: 'Classify assets as EMT, ART, or utility tokens per MiCA framework', default: true },
      { key: 'includeTravelRule', label: 'Travel Rule Check', description: 'Flag transfers over 1,000 EUR for Travel Rule compliance', default: true },
    ],
  },
  {
    code: 'BR',
    name: 'Brazil',
    flag: '\u{1F1E7}\u{1F1F7}',
    description: 'IN 1888, DARF, GCAP/DIRPF',
    costBasisMethods: [
      { value: 'FIFO', label: 'PEPS (Primeiro a Entrar, Primeiro a Sair)', description: 'M\u00E9todo padr\u00E3o aceito pela Receita Federal' },
      { value: 'AVERAGE', label: 'Pre\u00E7o M\u00E9dio', description: 'Custo m\u00E9dio ponderado — aceito para criptoativos' },
    ],
    currency: 'BRL',
    extraOptions: [
      { key: 'includeExemption', label: 'An\u00E1lise de Isen\u00E7\u00E3o R$35.000', description: 'Verificar se vendas mensais ficaram abaixo do limite de isen\u00E7\u00E3o', default: true },
      { key: 'includeIN1888', label: 'Gerar IN 1888', description: 'Relat\u00F3rio mensal para exchanges nacionais (acima de R$30.000)', default: true },
    ],
  },
];

const currentYear = new Date().getFullYear();
const TAX_YEARS = [currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4];

const STEP_LABELS = [
  { label: 'Jurisdiction', icon: Shield },
  { label: 'Configure', icon: Calculator },
  { label: 'Review', icon: FileCheck },
];

/* ─── Animation variants ─────────────────────────────────────────────── */

const container = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.08 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] } },
};

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -60 : 60, opacity: 0 }),
};

/* ─── Page ───────────────────────────────────────────────────────────── */

export default function NewAuditPage() {
  const { connected, publicKey } = useWallet();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [jurisdictionCode, setJurisdictionCode] = useState('');
  const [taxYear, setTaxYear] = useState(TAX_YEARS[0]);
  const [costBasisMethod, setCostBasisMethod] = useState('FIFO');
  const [includeStaking, setIncludeStaking] = useState(true);
  const [includeAirdrops, setIncludeAirdrops] = useState(true);
  const [includeNFTs, setIncludeNFTs] = useState(true);
  const [extraOptions, setExtraOptions] = useState<Record<string, boolean>>({});

  const jurisdiction = useMemo(
    () => JURISDICTIONS.find(j => j.code === jurisdictionCode),
    [jurisdictionCode],
  );

  useEffect(() => {
    if (!connected) redirect('/');
  }, [connected]);

  if (!connected || !publicKey) return null;

  const isBR = jurisdictionCode === 'BR';

  const goTo = (s: number) => {
    setDirection(s > step ? 1 : -1);
    setStep(s);
  };

  const handleJurisdictionChange = (code: string) => {
    setJurisdictionCode(code);
    const j = JURISDICTIONS.find(jur => jur.code === code);
    if (j) {
      setCostBasisMethod(j.costBasisMethods[0].value);
      const defaults: Record<string, boolean> = {};
      j.extraOptions.forEach(opt => { defaults[opt.key] = opt.default; });
      setExtraOptions(defaults);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const wallets = await listWallets();
      if (wallets.length === 0) {
        setError(isBR ? 'Nenhuma wallet encontrada. Adicione uma wallet primeiro.' : 'No wallets found. Please add a wallet first.');
        return;
      }

      const dto: CreateAuditDto = {
        walletIds: wallets.map(w => w.id),
        jurisdiction: jurisdictionCode as 'US' | 'EU' | 'BR',
        type: 'ANNUAL' as CreateAuditDto['type'],
        taxYear,
        options: {
          costBasisMethod: costBasisMethod as CreateAuditDto['options'] extends { costBasisMethod?: infer T } ? T : never,
          includeStaking,
          includeAirdrops,
          includeNFTs,
          includeDeFi: true,
          includeFees: true,
          currency: jurisdiction?.currency || 'USD',
          ...extraOptions,
        },
      };

      await createAudit(dto);
      router.push('/audits');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create audit';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

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
          {/* Back link */}
          <motion.div variants={fadeUp}>
            <Link
              href="/audits"
              className="inline-flex items-center gap-2 text-white/30 hover:text-white/60 text-sm transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Audits
            </Link>
          </motion.div>

          {/* Header */}
          <motion.div variants={fadeUp}>
            <h1 className="font-display text-2xl font-bold text-white">
              {isBR ? 'Nova Auditoria' : 'New Audit'}
            </h1>
            <p className="text-sm text-white/30 mt-1">
              {isBR
                ? 'Configure sua auditoria de conformidade fiscal'
                : 'Configure your tax compliance audit'}
            </p>
          </motion.div>

          {/* Step Indicator */}
          <motion.div variants={fadeUp}>
            <div className="flex items-center gap-2">
              {STEP_LABELS.map((s, i) => {
                const stepNum = i + 1;
                const Icon = s.icon;
                const isActive = step === stepNum;
                const isDone = step > stepNum;
                return (
                  <div key={i} className="flex items-center">
                    <button
                      onClick={() => { if (isDone) goTo(stepNum); }}
                      disabled={!isDone}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        isActive
                          ? 'bg-primary/15 text-primary border border-primary/20'
                          : isDone
                            ? 'bg-white/[0.04] text-white/50 border border-white/[0.06] hover:border-white/10 cursor-pointer'
                            : 'bg-white/[0.02] text-white/15 border border-white/[0.03]'
                      }`}
                    >
                      {isDone ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Icon className="w-3.5 h-3.5" />
                      )}
                      <span className="hidden sm:inline">{s.label}</span>
                      <span className="sm:hidden">{stepNum}</span>
                    </button>
                    {i < STEP_LABELS.length - 1 && (
                      <ChevronRight className={`w-3.5 h-3.5 mx-1 ${isDone ? 'text-white/20' : 'text-white/[0.06]'}`} />
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>

          {/* Step Content */}
          <motion.div variants={fadeUp}>
            <AnimatePresence mode="wait" custom={direction}>
              {/* ─── Step 1: Jurisdiction ─── */}
              {step === 1 && (
                <motion.div
                  key="step-1"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 p-6"
                >
                  <h2 className="font-display text-lg font-bold text-white mb-1">
                    {isBR ? 'Jurisdi\u00E7\u00E3o' : 'Select Jurisdiction'}
                  </h2>
                  <p className="text-xs text-white/30 mb-6">
                    {isBR
                      ? 'Cada jurisdi\u00E7\u00E3o possui agentes IA especializados com regras fiscais regionais.'
                      : 'Each jurisdiction has specialized AI bees with region-specific tax rules.'}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {JURISDICTIONS.map((j) => {
                      const selected = jurisdictionCode === j.code;
                      return (
                        <button
                          key={j.code}
                          onClick={() => handleJurisdictionChange(j.code)}
                          className={`relative text-left p-5 rounded-xl border-2 transition-all group ${
                            selected
                              ? 'border-primary/40 bg-primary/[0.06]'
                              : 'border-white/[0.06] bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.03]'
                          }`}
                        >
                          {selected && (
                            <div className="absolute top-3 right-3">
                              <CheckCircle2 className="w-4 h-4 text-primary" />
                            </div>
                          )}
                          <span className="text-3xl block mb-3">{j.flag}</span>
                          <p className={`text-sm font-semibold ${selected ? 'text-white' : 'text-white/70'}`}>
                            {j.name}
                          </p>
                          <p className="text-[11px] text-white/25 mt-1 leading-relaxed">
                            {j.description}
                          </p>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex justify-end mt-6">
                    <button
                      onClick={() => goTo(2)}
                      disabled={!jurisdictionCode}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-background text-sm font-semibold hover:bg-primary-400 disabled:opacity-30 disabled:hover:bg-primary transition-all"
                    >
                      {isBR ? 'Continuar' : 'Continue'}
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              )}

              {/* ─── Step 2: Configuration ─── */}
              {step === 2 && jurisdiction && (
                <motion.div
                  key="step-2"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 p-6"
                >
                  <h2 className="font-display text-lg font-bold text-white mb-1">
                    {isBR ? 'Per\u00EDodo e Op\u00E7\u00F5es' : 'Period & Options'}
                  </h2>
                  <p className="text-xs text-white/30 mb-6">
                    {isBR
                      ? 'Selecione o ano fiscal e configure as op\u00E7\u00F5es de c\u00E1lculo.'
                      : 'Select the tax year and configure calculation options.'}
                  </p>

                  {/* Tax Year */}
                  <div className="mb-6">
                    <label className="block text-[11px] text-white/30 uppercase tracking-wider font-medium mb-3">
                      {isBR ? 'Ano Fiscal' : 'Tax Year'}
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {TAX_YEARS.map((year) => (
                        <button
                          key={year}
                          onClick={() => setTaxYear(year)}
                          className={`py-2.5 rounded-xl border text-center font-mono text-sm font-medium transition-all ${
                            taxYear === year
                              ? 'border-primary/30 bg-primary/[0.06] text-primary'
                              : 'border-white/[0.06] text-white/30 hover:border-white/10 hover:text-white/50'
                          }`}
                        >
                          {year}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Cost Basis Method */}
                  <div className="mb-6">
                    <label className="block text-[11px] text-white/30 uppercase tracking-wider font-medium mb-3">
                      {isBR ? 'M\u00E9todo de Custo' : 'Cost Basis Method'}
                    </label>
                    <div className="space-y-2">
                      {jurisdiction.costBasisMethods.map((method) => {
                        const selected = costBasisMethod === method.value;
                        return (
                          <button
                            key={method.value}
                            onClick={() => setCostBasisMethod(method.value)}
                            className={`w-full flex items-start gap-3 p-4 rounded-xl border text-left transition-all ${
                              selected
                                ? 'border-primary/30 bg-primary/[0.06]'
                                : 'border-white/[0.06] hover:border-white/10'
                            }`}
                          >
                            <div className={`w-4 h-4 rounded-full border-2 shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                              selected ? 'border-primary' : 'border-white/15'
                            }`}>
                              {selected && <div className="w-2 h-2 rounded-full bg-primary" />}
                            </div>
                            <div>
                              <p className={`text-sm font-medium ${selected ? 'text-white' : 'text-white/60'}`}>
                                {method.label}
                              </p>
                              <p className="text-[11px] text-white/25 mt-0.5">{method.description}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Standard Options */}
                  <div className="mb-6">
                    <label className="block text-[11px] text-white/30 uppercase tracking-wider font-medium mb-3">
                      {isBR ? 'Incluir no Relat\u00F3rio' : 'Include in Report'}
                    </label>
                    <div className="space-y-2">
                      {[
                        { checked: includeStaking, onChange: setIncludeStaking, label: isBR ? 'Recompensas de staking' : 'Staking rewards' },
                        { checked: includeAirdrops, onChange: setIncludeAirdrops, label: 'Airdrops' },
                        { checked: includeNFTs, onChange: setIncludeNFTs, label: isBR ? 'Transa\u00E7\u00F5es de NFT' : 'NFT transactions' },
                      ].map((opt, i) => (
                        <button
                          key={i}
                          onClick={() => opt.onChange(!opt.checked)}
                          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.06] hover:border-white/10 text-left transition-all"
                        >
                          <div className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-all ${
                            opt.checked ? 'bg-primary border-primary' : 'border-white/15'
                          }`}>
                            {opt.checked && (
                              <svg className="w-2.5 h-2.5 text-background" viewBox="0 0 12 12" fill="none">
                                <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                          <span className="text-sm text-white/60">{opt.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Jurisdiction-Specific Options */}
                  {jurisdiction.extraOptions.length > 0 && (
                    <div className="mb-6">
                      <label className="block text-[11px] text-white/30 uppercase tracking-wider font-medium mb-3">
                        {jurisdictionCode === 'US' ? 'US-Specific Checks' : jurisdictionCode === 'EU' ? 'EU-Specific Options' : 'Op\u00E7\u00F5es Espec\u00EDficas BR'}
                      </label>
                      <div className="space-y-2">
                        {jurisdiction.extraOptions.map((opt) => {
                          const checked = extraOptions[opt.key] ?? opt.default;
                          return (
                            <button
                              key={opt.key}
                              onClick={() => setExtraOptions(prev => ({ ...prev, [opt.key]: !checked }))}
                              className="w-full flex items-start gap-3 px-4 py-3 rounded-xl border border-white/[0.06] hover:border-white/10 text-left transition-all"
                            >
                              <div className={`w-4 h-4 rounded border shrink-0 mt-0.5 flex items-center justify-center transition-all ${
                                checked ? 'bg-primary border-primary' : 'border-white/15'
                              }`}>
                                {checked && (
                                  <svg className="w-2.5 h-2.5 text-background" viewBox="0 0 12 12" fill="none">
                                    <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                )}
                              </div>
                              <div>
                                <p className="text-sm font-medium text-white/60">{opt.label}</p>
                                <p className="text-[11px] text-white/25 mt-0.5">{opt.description}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-between mt-6">
                    <button
                      onClick={() => goTo(1)}
                      className="flex items-center gap-2 text-white/30 hover:text-white/60 text-sm transition-colors"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      {isBR ? 'Voltar' : 'Back'}
                    </button>
                    <button
                      onClick={() => goTo(3)}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-background text-sm font-semibold hover:bg-primary-400 transition-all"
                    >
                      {isBR ? 'Revisar' : 'Review'}
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              )}

              {/* ─── Step 3: Review & Submit ─── */}
              {step === 3 && jurisdiction && (
                <motion.div
                  key="step-3"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className="rounded-2xl bg-surface/40 backdrop-blur-sm border border-white/5 p-6"
                >
                  <h2 className="font-display text-lg font-bold text-white mb-1">
                    {isBR ? 'Revisar e Confirmar' : 'Review & Submit'}
                  </h2>
                  <p className="text-xs text-white/30 mb-6">
                    {isBR
                      ? 'Verifique as configura\u00E7\u00F5es e confirme a auditoria.'
                      : 'Review your audit configuration before submitting.'}
                  </p>

                  {/* Summary */}
                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] divide-y divide-white/[0.04]">
                    <SummaryRow
                      label={isBR ? 'Jurisdi\u00E7\u00E3o' : 'Jurisdiction'}
                      value={`${jurisdiction.flag}  ${jurisdiction.name}`}
                    />
                    <SummaryRow
                      label={isBR ? 'Tipo' : 'Type'}
                      value={isBR ? 'Auditoria Anual' : 'Annual Audit'}
                    />
                    <SummaryRow
                      label={isBR ? 'Per\u00EDodo' : 'Tax Year'}
                      value={String(taxYear)}
                      mono
                    />
                    <SummaryRow
                      label={isBR ? 'M\u00E9todo de Custo' : 'Cost Basis'}
                      value={jurisdiction.costBasisMethods.find(m => m.value === costBasisMethod)?.label ?? costBasisMethod}
                    />
                    <SummaryRow
                      label={isBR ? 'Moeda' : 'Currency'}
                      value={jurisdiction.currency}
                      mono
                    />
                    <SummaryRow
                      label="Wallet"
                      value={`${publicKey.toBase58().slice(0, 6)}...${publicKey.toBase58().slice(-4)}`}
                      mono
                    />
                  </div>

                  {/* Included features */}
                  <div className="flex flex-wrap gap-2 mt-5">
                    {includeStaking && <FeatureBadge label="Staking" />}
                    {includeAirdrops && <FeatureBadge label="Airdrops" />}
                    {includeNFTs && <FeatureBadge label="NFTs" />}
                    {Object.entries(extraOptions).filter(([, v]) => v).map(([k]) => {
                      const opt = jurisdiction.extraOptions.find(o => o.key === k);
                      return opt ? <FeatureBadge key={k} label={opt.label} /> : null;
                    })}
                  </div>

                  {/* Error */}
                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-5 rounded-xl bg-red-500/[0.06] border border-red-500/15 px-4 py-3">
                          <p className="text-sm text-red-400">{error}</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="flex justify-between mt-6">
                    <button
                      onClick={() => goTo(2)}
                      className="flex items-center gap-2 text-white/30 hover:text-white/60 text-sm transition-colors"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      {isBR ? 'Voltar' : 'Back'}
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={loading}
                      className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-background text-sm font-semibold hover:bg-primary-400 disabled:opacity-50 transition-all"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {isBR ? 'Processando...' : 'Processing...'}
                        </>
                      ) : (
                        <>
                          {isBR ? 'Solicitar Auditoria' : 'Request Audit'}
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.main>
      </div>
    </div>
  );
}

/* ─── Helper components ──────────────────────────────────────────────── */

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-xs text-white/30">{label}</span>
      <span className={`text-sm text-white/70 ${mono ? 'font-mono' : 'font-medium'}`}>{value}</span>
    </div>
  );
}

function FeatureBadge({ label }: { label: string }) {
  return (
    <span className="px-3 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-medium border border-primary/10">
      {label}
    </span>
  );
}
