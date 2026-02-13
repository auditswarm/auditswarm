'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useConnection } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { motion, AnimatePresence } from 'framer-motion';
import {
  registerPaymentHandler,
  type PaymentInstructions,
} from '@/lib/x402';

interface PendingPayment {
  instructions: PaymentInstructions;
  resolve: (signature: string) => void;
  reject: (error: Error) => void;
}

interface PaymentContextType {
  isPaying: boolean;
}

const PaymentContext = createContext<PaymentContextType>({ isPaying: false });

export function PaymentProvider({ children }: { children: ReactNode }) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<PendingPayment | null>(null);

  const handlePayment = useCallback(
    (instructions: PaymentInstructions): Promise<string> => {
      return new Promise<string>((resolve, reject) => {
        const payment: PendingPayment = { instructions, resolve, reject };
        pendingRef.current = payment;
        setPending(payment);
        setError(null);
      });
    },
    [],
  );

  useEffect(() => {
    registerPaymentHandler(handlePayment);
    return () => registerPaymentHandler(null);
  }, [handlePayment]);

  const onPay = useCallback(async () => {
    const current = pendingRef.current;
    if (!current || !publicKey || !sendTransaction) return;

    setSending(true);
    setError(null);

    try {
      const lamports = Math.ceil(parseFloat(current.instructions.amount) * LAMPORTS_PER_SOL);
      const recipient = new PublicKey(current.instructions.payTo);

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: recipient,
          lamports,
        }),
      );

      const signature = await sendTransaction(tx, connection);
      await connection.confirmTransaction(signature, 'confirmed');

      current.resolve(signature);
      pendingRef.current = null;
      setPending(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transaction failed';
      setError(msg);
    } finally {
      setSending(false);
    }
  }, [publicKey, sendTransaction, connection]);

  const onCancel = useCallback(() => {
    const current = pendingRef.current;
    if (current) {
      current.reject(new Error('Payment cancelled'));
      pendingRef.current = null;
      setPending(null);
      setError(null);
    }
  }, []);

  const onRetry = useCallback(() => {
    setError(null);
    onPay();
  }, [onPay]);

  return (
    <PaymentContext.Provider value={{ isPaying: !!pending }}>
      {children}
      <AnimatePresence>
        {pending && (
          <motion.div
            key="payment-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget && !sending) onCancel();
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="w-full max-w-md rounded-2xl border border-white/10 bg-[#1a1a2e] p-6 shadow-2xl"
            >
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/20">
                  <svg
                    className="h-5 w-5 text-amber-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3m0 4h.01M3 12a9 9 0 1118 0 9 9 0 01-18 0z"
                    />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-white">Payment Required</h2>
              </div>

              <p className="mb-4 text-sm text-gray-400">
                {pending.instructions.description ||
                  `Access to ${pending.instructions.resource} requires a small payment.`}
              </p>

              <div className="mb-6 rounded-xl border border-white/5 bg-white/5 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Amount</span>
                  <span className="text-xl font-bold text-white">
                    {pending.instructions.amount}{' '}
                    <span className="text-sm font-normal text-gray-400">
                      {pending.instructions.currency}
                    </span>
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                  <span>Network</span>
                  <span>{pending.instructions.network}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
                  <span>Recipient</span>
                  <span className="font-mono">
                    {pending.instructions.payTo.slice(0, 4)}...
                    {pending.instructions.payTo.slice(-4)}
                  </span>
                </div>
              </div>

              {error && (
                <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={onCancel}
                  disabled={sending}
                  className="flex-1 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-gray-400 transition hover:bg-white/5 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={error ? onRetry : onPay}
                  disabled={sending}
                  className="flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-black transition hover:bg-amber-400 disabled:opacity-50"
                >
                  {sending ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg
                        className="h-4 w-4 animate-spin"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                      Confirming...
                    </span>
                  ) : error ? (
                    'Retry'
                  ) : (
                    `Pay ${pending.instructions.amount} ${pending.instructions.currency}`
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </PaymentContext.Provider>
  );
}

export function usePayment() {
  return useContext(PaymentContext);
}
