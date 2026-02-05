import { useState, useCallback, useEffect } from 'react';
import { useAuditSwarm } from '../provider';
import type { Wallet } from '@auditswarm.xyz/client';

interface UseWalletsState {
  wallets: Wallet[];
  loading: boolean;
  error: Error | null;
}

interface UseWalletsActions {
  loadWallets: () => Promise<void>;
  addWallet: (address: string, label?: string) => Promise<Wallet>;
  updateWallet: (id: string, data: { label?: string }) => Promise<Wallet>;
  removeWallet: (id: string) => Promise<void>;
}

export function useWallets(autoLoad = true): UseWalletsState & UseWalletsActions {
  const { client } = useAuditSwarm();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const loadWallets = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const list = await client.getWallets();
      setWallets(list);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to load wallets');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client]);

  const addWallet = useCallback(async (
    address: string,
    label?: string,
  ): Promise<Wallet> => {
    setLoading(true);
    setError(null);
    try {
      const newWallet = await client.createWallet({ address, label });
      setWallets(prev => [...prev, newWallet]);
      return newWallet;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to add wallet');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client]);

  const updateWallet = useCallback(async (
    id: string,
    data: { label?: string },
  ): Promise<Wallet> => {
    setLoading(true);
    setError(null);
    try {
      const updated = await client.updateWallet(id, data);
      setWallets(prev => prev.map(w => w.id === id ? updated : w));
      return updated;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to update wallet');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client]);

  const removeWallet = useCallback(async (id: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await client.deleteWallet(id);
      setWallets(prev => prev.filter(w => w.id !== id));
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to remove wallet');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (autoLoad) {
      loadWallets().catch(() => {});
    }
  }, [autoLoad, loadWallets]);

  return {
    wallets,
    loading,
    error,
    loadWallets,
    addWallet,
    updateWallet,
    removeWallet,
  };
}
