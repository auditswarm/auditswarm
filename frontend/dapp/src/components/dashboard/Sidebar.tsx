'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Wallet,
  PieChart,
  FileSearch,
  FileCheck,
  Settings,
  LogOut,
  Menu,
  X,
  Bell,
} from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { useWallet } from '@solana/wallet-adapter-react';
import { useState } from 'react';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/wallets', label: 'Wallets', icon: Wallet },
  { href: '/holdings', label: 'Holdings', icon: PieChart },
  { href: '/audits', label: 'Audits', icon: FileSearch },
  { href: '/reports', label: 'Reports', icon: FileCheck },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Navbar() {
  const pathname = usePathname();
  const { publicKey, disconnect } = useWallet();
  const [mobileOpen, setMobileOpen] = useState(false);

  const truncatedAddress = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
    : '';

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-surface/70 backdrop-blur-2xl border-b border-white/5">
        <div className="max-w-[1600px] mx-auto h-full flex items-center justify-between px-5 lg:px-8">
          {/* Left: Logo */}
          <Link href="/dashboard" className="flex items-center gap-2.5 shrink-0">
            <Logo size={28} className="text-primary" />
            <span className="font-display font-bold text-lg tracking-tight">
              Audit<span className="text-primary">Swarm</span>
            </span>
          </Link>

          {/* Center: Nav links (desktop) */}
          <nav className="hidden md:flex items-center gap-1 bg-white/[0.03] rounded-xl p-1">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;

              return (
                <Link key={item.href} href={item.href}>
                  <div className="relative px-4 py-2 rounded-lg flex items-center gap-2">
                    {isActive && (
                      <motion.div
                        layoutId="nav-active"
                        className="absolute inset-0 bg-white/[0.06] rounded-lg"
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      />
                    )}
                    <Icon
                      className={`relative w-4 h-4 ${
                        isActive ? 'text-primary' : 'text-white/30'
                      }`}
                    />
                    <span
                      className={`relative text-sm font-medium ${
                        isActive ? 'text-white' : 'text-white/40 hover:text-white/60'
                      } transition-colors`}
                    >
                      {item.label}
                    </span>
                  </div>
                </Link>
              );
            })}
          </nav>

          {/* Right: Actions */}
          <div className="flex items-center gap-2.5">
            {/* Notification bell */}
            <button className="relative w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center text-white/30 hover:text-white hover:bg-white/10 transition-all">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full" />
            </button>

            {/* Wallet chip (desktop) */}
            <div className="hidden sm:flex items-center gap-2.5 pl-3 pr-1.5 py-1.5 rounded-full bg-white/5 border border-white/5">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-xs font-mono text-white/50">{truncatedAddress}</span>
              <button
                onClick={() => disconnect()}
                className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-all"
                title="Disconnect wallet"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Mobile menu toggle */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            >
              {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile dropdown menu */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="fixed top-16 left-0 right-0 z-50 bg-surface/95 backdrop-blur-2xl border-b border-white/5 md:hidden"
            >
              <nav className="p-3 space-y-1">
                {NAV_ITEMS.map((item) => {
                  const isActive = pathname === item.href;
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                    >
                      <div
                        className={`
                          flex items-center gap-3 px-4 py-3 rounded-xl transition-all
                          ${isActive
                            ? 'bg-primary/10 text-primary'
                            : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                          }
                        `}
                      >
                        <Icon className="w-5 h-5" />
                        <span className="text-sm font-medium">{item.label}</span>
                      </div>
                    </Link>
                  );
                })}
              </nav>

              {/* Mobile wallet info */}
              <div className="p-3 border-t border-white/5">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                    <span className="text-sm font-mono text-white/50">{truncatedAddress}</span>
                  </div>
                  <button
                    onClick={() => disconnect()}
                    className="text-xs text-white/30 hover:text-red-400 transition-colors flex items-center gap-1.5"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Disconnect
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
