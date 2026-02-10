'use client';

import { ShieldOff, Container, Trash2 } from 'lucide-react';
import { SectionHeader, Card, CardIcon, CardTitle, CardDescription } from '@/components/ui';

const features = [
  {
    icon: ShieldOff,
    title: 'Zero KYC',
    description:
      'No identity verification required. Connect your wallet and go. Your privacy is preserved throughout the entire process.',
  },
  {
    icon: Container,
    title: 'Sandboxed Sessions',
    description:
      'Each audit runs in an isolated gVisor container. Your data never touches shared infrastructure or other sessions.',
  },
  {
    icon: Trash2,
    title: 'Ephemeral Processing',
    description:
      'All transaction data is destroyed after your audit completes. Only the final attestation hash persists on-chain.',
  },
];

export function SecurityPrivacyStep() {
  return (
    <div>
      <SectionHeader
        tag="// SECURITY & PRIVACY"
        title="Your Data, Your Control"
        description="AuditSwarm is built with privacy-first architecture. No personal data is ever collected or stored."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-10">
        {features.map((feature, i) => (
          <Card key={feature.title} className={`animate-fade-up stagger-${i + 1}`}>
            <CardIcon icon={feature.icon} />
            <CardTitle>{feature.title}</CardTitle>
            <CardDescription>{feature.description}</CardDescription>
          </Card>
        ))}
      </div>
    </div>
  );
}
