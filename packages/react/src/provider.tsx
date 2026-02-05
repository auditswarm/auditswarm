import React, { createContext, useContext, useMemo } from 'react';
import { AuditSwarmClient, type AuditSwarmConfig } from '@auditswarm.xyz/client';

interface AuditSwarmContextValue {
  client: AuditSwarmClient;
}

const AuditSwarmContext = createContext<AuditSwarmContextValue | null>(null);

export interface AuditSwarmProviderProps {
  config: AuditSwarmConfig;
  children: React.ReactNode;
}

export function AuditSwarmProvider({ config, children }: AuditSwarmProviderProps) {
  const client = useMemo(() => new AuditSwarmClient(config), [config]);

  const value = useMemo(() => ({ client }), [client]);

  return (
    <AuditSwarmContext.Provider value={value}>
      {children}
    </AuditSwarmContext.Provider>
  );
}

export function useAuditSwarm(): AuditSwarmContextValue {
  const context = useContext(AuditSwarmContext);
  if (!context) {
    throw new Error('useAuditSwarm must be used within an AuditSwarmProvider');
  }
  return context;
}
