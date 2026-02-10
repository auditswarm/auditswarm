'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import {
  Wallet,
  ArrowLeft,
  ExternalLink,
  Loader2,
  AlertTriangle,
  RefreshCw,
  LogOut,
} from 'lucide-react';
import { Logo } from '@/components/ui';
import { useAuthContext } from '@/contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';

type View = 'connect' | 'wallets' | 'signing' | 'error';

export function WalletConnectHero() {
  const { wallets, select, connecting, connected, disconnect } = useWallet();
  const { isLoading, authError, signIn } = useAuthContext();
  const [view, setView] = useState<View>('connect');

  const installed = wallets.filter(
    (w) => w.readyState === WalletReadyState.Installed
  );
  const notInstalled = wallets.filter(
    (w) => w.readyState !== WalletReadyState.Installed
  );

  const handleSelect = (walletName: string) => {
    select(walletName as any);
  };

  // Derive the actual view based on state
  const currentView: View = (() => {
    if (isLoading || connecting) return 'signing';
    if (connected && authError) return 'error';
    return view;
  })();

  return (
    <section className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* Logo — outside card */}
        <div className="flex flex-col items-center mb-6">
          <Logo size={40} className="text-primary mb-3" />
          <h1 className="text-xl font-semibold tracking-tight">
            Audit<span className="text-primary">Swarm</span>
          </h1>
        </div>

        {/* Card */}
        <motion.div
          layout
          className="relative rounded-2xl border border-white/[0.08] bg-surface/80 backdrop-blur-xl shadow-2xl overflow-hidden"
          transition={{ layout: { duration: 0.35, ease: [0.4, 0, 0.2, 1] } }}
        >
          {/* Glow */}
          <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-primary/20 via-transparent to-transparent opacity-50 -z-10 blur-sm" />

          <motion.div layout className="p-8">
            <AnimatePresence mode="wait">
              {/* --- DEFAULT: Connect Wallet button --- */}
              {currentView === 'connect' && (
                <motion.div
                  key="connect"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.25 }}
                >
                  <button
                    onClick={() => setView('wallets')}
                    className="w-full flex items-center justify-center gap-2.5 px-6 py-3.5 bg-primary text-background font-semibold rounded-xl hover:bg-primary-400 transition-all hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <Wallet className="w-4 h-4" />
                    Connect Wallet
                  </button>

                  <div className="h-px bg-white/[0.06] my-6" />

                  <p className="text-center text-[11px] text-gray-600 leading-relaxed">
                    Sign-In with Solana (SIWS). No email or password needed.
                    <br />
                    Your keys, your identity.
                  </p>
                </motion.div>
              )}

              {/* --- WALLET LIST --- */}
              {currentView === 'wallets' && (
                <motion.div
                  key="wallets"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.25 }}
                >
                  <button
                    onClick={() => setView('connect')}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-white transition-colors mb-5"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back
                  </button>

                  {installed.length > 0 && (
                    <>
                      <span className="text-[11px] text-gray-600 font-mono uppercase tracking-wider block mb-3">
                        Detected
                      </span>
                      <div className="grid grid-cols-2 gap-2 mb-4">
                        {installed.map((wallet, i) => (
                          <motion.button
                            key={wallet.adapter.name}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: i * 0.06, duration: 0.25 }}
                            onClick={() => handleSelect(wallet.adapter.name)}
                            disabled={connecting}
                            className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-white/[0.06] bg-white/[0.03] hover:bg-primary/10 hover:border-primary/30 transition-all group disabled:opacity-50"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={wallet.adapter.icon}
                              alt={wallet.adapter.name}
                              className="w-6 h-6 rounded-md"
                            />
                            <span className="text-xs font-medium group-hover:text-primary transition-colors truncate">
                              {wallet.adapter.name}
                            </span>
                            {connecting ? (
                              <Loader2 className="w-3 h-3 text-primary animate-spin ml-auto shrink-0" />
                            ) : (
                              <div className="w-1.5 h-1.5 rounded-full bg-green-500 ml-auto shrink-0" />
                            )}
                          </motion.button>
                        ))}
                      </div>
                    </>
                  )}

                  {notInstalled.length > 0 && (
                    <>
                      <span className="text-[11px] text-gray-600 font-mono uppercase tracking-wider block mb-3">
                        More wallets
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        {notInstalled.map((wallet, i) => (
                          <motion.a
                            key={wallet.adapter.name}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{
                              delay: installed.length * 0.06 + i * 0.06,
                              duration: 0.25,
                            }}
                            href={wallet.adapter.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.04] transition-all group opacity-60 hover:opacity-80"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={wallet.adapter.icon}
                              alt={wallet.adapter.name}
                              className="w-6 h-6 rounded-md grayscale group-hover:grayscale-0 transition-all"
                            />
                            <span className="text-xs font-medium text-gray-400 truncate">
                              {wallet.adapter.name}
                            </span>
                            <ExternalLink className="w-3 h-3 text-gray-600 ml-auto shrink-0" />
                          </motion.a>
                        ))}
                      </div>
                    </>
                  )}

                  {wallets.length === 0 && (
                    <div className="text-center py-6">
                      <p className="text-sm text-gray-400">No wallets found</p>
                      <p className="text-xs text-gray-600 mt-1">
                        Install a Solana wallet to continue
                      </p>
                    </div>
                  )}
                </motion.div>
              )}

              {/* --- SIGNING / LOADING --- */}
              {currentView === 'signing' && (
                <motion.div
                  key="signing"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.25 }}
                  className="flex flex-col items-center py-4"
                >
                  <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
                  <p className="text-sm text-gray-300 font-medium">
                    {connecting
                      ? 'Connecting wallet...'
                      : 'Verifying wallet ownership...'}
                  </p>
                  <p className="text-[11px] text-gray-600 mt-1">
                    {connecting
                      ? 'Approve in your wallet'
                      : 'Sign the message in your wallet'}
                  </p>
                </motion.div>
              )}

              {/* --- ERROR --- */}
              {currentView === 'error' && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.25 }}
                  className="flex flex-col items-center"
                >
                  <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                  </div>
                  <p className="text-sm text-gray-300 font-medium text-center mb-1">
                    Connection failed
                  </p>
                  <p className="text-[11px] text-gray-500 text-center mb-6 max-w-[250px]">
                    {authError}
                  </p>

                  <div className="flex gap-2 w-full">
                    <button
                      onClick={() => {
                        disconnect();
                        setView('connect');
                      }}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-white/[0.06] bg-white/[0.03] text-gray-400 hover:text-white text-xs font-medium transition-all"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Disconnect
                    </button>
                    <button
                      onClick={() => signIn()}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-background text-xs font-semibold hover:bg-primary-400 transition-all"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Retry
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>

        {/* Network indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="flex items-center justify-center gap-1.5 mt-5"
        >
          <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
          <span className="text-[11px] text-gray-600">Devnet</span>
        </motion.div>
      </div>
    </section>
  );
}
