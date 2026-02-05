import { useState, useCallback } from 'react';
import { useAuditSwarm } from '../provider';
import type { Audit, AuditResult, AuditRequest } from '@auditswarm.xyz/client';

interface UseAuditState {
  audit: Audit | null;
  result: AuditResult | null;
  loading: boolean;
  error: Error | null;
}

interface UseAuditActions {
  createAudit: (request: AuditRequest) => Promise<Audit>;
  loadAudit: (id: string) => Promise<void>;
  loadResult: (id: string) => Promise<void>;
  pollStatus: (id: string, intervalMs?: number) => () => void;
  cancelAudit: (id: string) => Promise<void>;
}

export function useAudit(): UseAuditState & UseAuditActions {
  const { client } = useAuditSwarm();
  const [audit, setAudit] = useState<Audit | null>(null);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const createAudit = useCallback(async (request: AuditRequest): Promise<Audit> => {
    setLoading(true);
    setError(null);
    try {
      const newAudit = await client.createAudit(request);
      setAudit(newAudit);
      return newAudit;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to create audit');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client]);

  const loadAudit = useCallback(async (id: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const loadedAudit = await client.getAudit(id);
      setAudit(loadedAudit);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to load audit');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client]);

  const loadResult = useCallback(async (id: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const loadedResult = await client.getAuditResult(id);
      setResult(loadedResult);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to load audit result');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client]);

  const pollStatus = useCallback((id: string, intervalMs = 5000): (() => void) => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const status = await client.getAuditStatus(id);
        setAudit(prev => prev ? { ...prev, ...status } : prev);

        if (status.status === 'COMPLETED' || status.status === 'FAILED') {
          if (status.status === 'COMPLETED') {
            await loadResult(id);
          }
          return;
        }

        timeoutId = setTimeout(poll, intervalMs);
      } catch (err) {
        console.error('Polling error:', err);
        timeoutId = setTimeout(poll, intervalMs * 2);
      }
    };

    poll();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [client, loadResult]);

  const cancelAudit = useCallback(async (id: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await client.cancelAudit(id);
      setAudit(null);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to cancel audit');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client]);

  return {
    audit,
    result,
    loading,
    error,
    createAudit,
    loadAudit,
    loadResult,
    pollStatus,
    cancelAudit,
  };
}
