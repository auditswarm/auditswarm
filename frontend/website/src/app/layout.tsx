import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AuditSwarm - AI-Powered Crypto Tax Compliance',
  description: 'Swarm intelligence meets crypto tax compliance. Automated audits, on-chain attestations, and multi-jurisdiction support powered by AI agents.',
  keywords: ['crypto tax', 'blockchain compliance', 'AI audit', 'Solana', 'tax reporting'],
  openGraph: {
    title: 'AuditSwarm - AI-Powered Crypto Tax Compliance',
    description: 'Swarm intelligence meets crypto tax compliance.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
