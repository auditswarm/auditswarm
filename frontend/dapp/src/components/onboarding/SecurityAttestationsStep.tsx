'use client';

import { Database, Eye, Lock } from 'lucide-react';
import { SectionHeader } from '@/components/ui';

const features = [
  {
    icon: Database,
    title: 'Permanent Record',
    description:
      'Your compliance attestation is stored on Solana as a Program Derived Address (PDA), creating an immutable audit trail.',
  },
  {
    icon: Eye,
    title: 'Publicly Verifiable',
    description:
      'Anyone can verify your compliance status on-chain. Share your attestation with regulators, auditors, or counterparties.',
  },
  {
    icon: Lock,
    title: 'Privacy Preserving',
    description:
      'Only a cryptographic hash of your audit is stored on-chain. The full report remains private and in your control.',
  },
];

export function SecurityAttestationsStep() {
  return (
    <div>
      <SectionHeader
        tag="// ON-CHAIN ATTESTATIONS"
        title="Immutable Proof of Compliance"
        description="Every completed audit generates a verifiable attestation on the Solana blockchain."
      />

      <div className="space-y-6 mt-10">
        {features.map((feature, i) => {
          const Icon = feature.icon;
          return (
            <div
              key={feature.title}
              className={`flex items-start gap-5 p-6 rounded-2xl border border-white/5 bg-surface/30 animate-fade-up stagger-${i + 1}`}
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-display text-lg font-bold mb-1">{feature.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{feature.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* PDA seed structure */}
      <div className="mt-10 p-6 rounded-2xl border border-white/5 bg-surface/30">
        <h4 className="font-mono text-sm text-primary mb-4">// PDA SEED STRUCTURE</h4>
        <pre className="font-mono text-sm text-gray-400 overflow-x-auto">
{`seeds = [
  b"attestation",
  wallet_pubkey.as_ref(),
  jurisdiction.as_bytes(),   // "US" | "EU" | "BR"
  attestation_type.as_bytes(), // "tax_compliance"
  tax_year.to_le_bytes(),    // 2025
]`}
        </pre>
      </div>
    </div>
  );
}
