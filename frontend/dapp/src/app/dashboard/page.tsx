'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { redirect } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';
import {
  Wallet,
  FileSearch,
  FileCheck,
  Settings,
  Plus,
  ArrowRight,
  CheckCircle,
  AlertCircle,
  Clock,
} from 'lucide-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export default function Dashboard() {
  const { connected, publicKey } = useWallet();

  useEffect(() => {
    if (!connected) {
      redirect('/');
    }
  }, [connected]);

  if (!connected || !publicKey) {
    return null;
  }

  const truncatedAddress = `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-2xl font-bold text-gray-900 dark:text-white">
            <span className="text-primary-500">Audit</span>Swarm
          </Link>
          <div className="flex items-center gap-4">
            <nav className="hidden md:flex gap-6">
              <NavLink href="/dashboard" active>Dashboard</NavLink>
              <NavLink href="/wallets">Wallets</NavLink>
              <NavLink href="/audits">Audits</NavLink>
              <NavLink href="/reports">Reports</NavLink>
              <NavLink href="/settings">Settings</NavLink>
            </nav>
            <WalletMultiButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">
          Dashboard
        </h1>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard
            icon={<Wallet className="w-6 h-6" />}
            label="Connected Wallets"
            value="1"
            subtext={truncatedAddress}
          />
          <StatCard
            icon={<FileSearch className="w-6 h-6" />}
            label="Total Audits"
            value="0"
            subtext="Request your first audit"
          />
          <StatCard
            icon={<FileCheck className="w-6 h-6" />}
            label="Active Attestations"
            value="0"
            subtext="No attestations yet"
          />
          <StatCard
            icon={<Clock className="w-6 h-6" />}
            label="Pending Tasks"
            value="1"
            subtext="Complete profile"
          />
        </div>

        {/* Quick Actions */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            Quick Actions
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ActionCard
              href="/audits/new"
              icon={<Plus className="w-5 h-5" />}
              title="New Audit"
              description="Request a tax compliance audit"
              primary
            />
            <ActionCard
              href="/wallets"
              icon={<Wallet className="w-5 h-5" />}
              title="Manage Wallets"
              description="Add or remove wallet addresses"
            />
            <ActionCard
              href="/reports"
              icon={<FileCheck className="w-5 h-5" />}
              title="View Reports"
              description="Download tax reports and forms"
            />
          </div>
        </div>

        {/* Recent Audits */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Recent Audits
            </h2>
            <Link
              href="/audits"
              className="text-primary-500 hover:text-primary-600 flex items-center gap-1"
            >
              View all <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-8 text-center">
            <FileSearch className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              No audits yet
            </h3>
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              Request your first audit to get started with tax compliance.
            </p>
            <Link
              href="/audits/new"
              className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-6 py-2 rounded-lg font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              Request Audit
            </Link>
          </div>
        </div>

        {/* Compliance Status */}
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            Compliance Status
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ComplianceCard
              jurisdiction="US"
              name="United States"
              status="needs_review"
            />
            <ComplianceCard
              jurisdiction="EU"
              name="European Union"
              status="unknown"
            />
            <ComplianceCard
              jurisdiction="BR"
              name="Brazil"
              status="unknown"
            />
          </div>
        </div>
      </main>
    </div>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`text-sm font-medium ${
        active
          ? 'text-primary-500'
          : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
      }`}
    >
      {children}
    </Link>
  );
}

function StatCard({
  icon,
  label,
  value,
  subtext,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtext: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="text-primary-500">{icon}</div>
        <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      </div>
      <div className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
        {value}
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400">{subtext}</div>
    </div>
  );
}

function ActionCard({
  href,
  icon,
  title,
  description,
  primary,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`block p-6 rounded-xl border transition-all ${
        primary
          ? 'bg-primary-500 hover:bg-primary-600 border-primary-500 text-white'
          : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border-gray-100 dark:border-gray-700'
      }`}
    >
      <div className="flex items-center gap-3 mb-2">
        {icon}
        <span className={`font-medium ${primary ? 'text-white' : 'text-gray-900 dark:text-white'}`}>
          {title}
        </span>
      </div>
      <p className={`text-sm ${primary ? 'text-primary-100' : 'text-gray-500 dark:text-gray-400'}`}>
        {description}
      </p>
    </Link>
  );
}

function ComplianceCard({
  jurisdiction,
  name,
  status,
}: {
  jurisdiction: string;
  name: string;
  status: 'compliant' | 'needs_review' | 'non_compliant' | 'unknown';
}) {
  const statusConfig = {
    compliant: {
      icon: <CheckCircle className="w-5 h-5 text-green-500" />,
      text: 'Compliant',
      color: 'text-green-500',
    },
    needs_review: {
      icon: <AlertCircle className="w-5 h-5 text-yellow-500" />,
      text: 'Needs Review',
      color: 'text-yellow-500',
    },
    non_compliant: {
      icon: <AlertCircle className="w-5 h-5 text-red-500" />,
      text: 'Non-Compliant',
      color: 'text-red-500',
    },
    unknown: {
      icon: <Clock className="w-5 h-5 text-gray-400" />,
      text: 'Not Checked',
      color: 'text-gray-400',
    },
  };

  const config = statusConfig[status];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-lg font-bold text-gray-600 dark:text-gray-300">
          {jurisdiction}
        </div>
        {config.icon}
      </div>
      <h3 className="font-medium text-gray-900 dark:text-white">{name}</h3>
      <p className={`text-sm ${config.color}`}>{config.text}</p>
    </div>
  );
}
