import { z } from 'zod';

export const JurisdictionCode = z.enum(['US', 'EU', 'BR', 'UK', 'JP', 'AU', 'CA', 'CH', 'SG']);
export type JurisdictionCode = z.infer<typeof JurisdictionCode>;

export interface Jurisdiction {
  code: JurisdictionCode;
  name: string;
  currency: string;
  taxYear: {
    start: { month: number; day: number };
    end: { month: number; day: number };
  };
  features: {
    capitalGains: boolean;
    income: boolean;
    mining: boolean;
    staking: boolean;
    airdrops: boolean;
    nfts: boolean;
    defi: boolean;
  };
  reportFormats: string[];
}

export interface JurisdictionConfig {
  code: JurisdictionCode;
  regulations: RegulationDocument[];
  taxRates: TaxRate[];
  reportingRequirements: ReportingRequirement[];
  thresholds: Threshold[];
}

export interface RegulationDocument {
  id: string;
  name: string;
  url: string;
  effectiveDate: Date;
  version: string;
}

export interface TaxRate {
  type: 'capital_gains_short' | 'capital_gains_long' | 'income' | 'mining' | 'staking';
  rate: number;
  bracket?: { min: number; max: number };
  holdingPeriod?: number; // days
}

export interface ReportingRequirement {
  type: string;
  form: string;
  threshold?: number;
  description: string;
  deadline: string;
}

export interface Threshold {
  type: string;
  amount: number;
  currency: string;
  description: string;
}
