import { useState, useCallback } from 'react';
import { useAuditSwarm } from '../provider';
import type { ComplianceCheck, JurisdictionCode } from '@auditswarm.xyz/client';

interface UseComplianceState {
  check: ComplianceCheck | null;
  loading: boolean;
  error: Error | null;
}

interface UseComplianceActions {
  checkCompliance: (
    walletAddress: string,
    jurisdiction: JurisdictionCode,
    taxYear?: number,
  ) => Promise<ComplianceCheck>;
  reset: () => void;
}

export function useCompliance(): UseComplianceState & UseComplianceActions {
  const { client } = useAuditSwarm();
  const [check, setCheck] = useState<ComplianceCheck | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const checkCompliance = useCallback(async (
    walletAddress: string,
    jurisdiction: JurisdictionCode,
    taxYear?: number,
  ): Promise<ComplianceCheck> => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.checkCompliance({
        walletAddress,
        jurisdiction,
        taxYear,
      });
      setCheck(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to check compliance');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client]);

  const reset = useCallback(() => {
    setCheck(null);
    setError(null);
  }, []);

  return {
    check,
    loading,
    error,
    checkCompliance,
    reset,
  };
}
