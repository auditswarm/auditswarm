import { useState, useCallback } from 'react';
import { useAuditSwarm } from '../provider';
import type { Attestation, JurisdictionCode } from '@auditswarm.xyz/client';

interface UseAttestationState {
  attestation: Attestation | null;
  attestations: Attestation[];
  verification: { valid: boolean; message: string } | null;
  loading: boolean;
  error: Error | null;
}

interface UseAttestationActions {
  createAttestation: (params: {
    auditId: string;
    walletId: string;
    type: string;
    expiresInDays?: number;
  }) => Promise<Attestation>;
  loadByWallet: (walletId: string) => Promise<void>;
  verify: (address: string, jurisdiction: JurisdictionCode) => Promise<boolean>;
  revoke: (id: string, reason: string) => Promise<void>;
}

export function useAttestation(): UseAttestationState & UseAttestationActions {
  const { client } = useAuditSwarm();
  const [attestation, setAttestation] = useState<Attestation | null>(null);
  const [attestations, setAttestations] = useState<Attestation[]>([]);
  const [verification, setVerification] = useState<{ valid: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const createAttestation = useCallback(async (params: {
    auditId: string;
    walletId: string;
    type: string;
    expiresInDays?: number;
  }): Promise<Attestation> => {
    setLoading(true);
    setError(null);
    try {
      const newAttestation = await client.createAttestation(params);
      setAttestation(newAttestation);
      return newAttestation;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to create attestation');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client]);

  const loadByWallet = useCallback(async (walletId: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const list = await client.getAttestationsByWallet(walletId);
      setAttestations(list);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to load attestations');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client]);

  const verify = useCallback(async (
    address: string,
    jurisdiction: JurisdictionCode,
  ): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.verifyAttestation(address, jurisdiction);
      setVerification({ valid: result.valid, message: result.message });
      if (result.attestation) {
        setAttestation(result.attestation);
      }
      return result.valid;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to verify attestation');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client]);

  const revoke = useCallback(async (id: string, reason: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await client.revokeAttestation(id, reason);
      setAttestation(null);
      setAttestations(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to revoke attestation');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [client]);

  return {
    attestation,
    attestations,
    verification,
    loading,
    error,
    createAttestation,
    loadByWallet,
    verify,
    revoke,
  };
}
