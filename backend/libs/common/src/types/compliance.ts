import { z } from 'zod';
import { JurisdictionCode } from './jurisdiction';

export const ComplianceStatus = z.enum([
  'COMPLIANT',
  'NON_COMPLIANT',
  'NEEDS_REVIEW',
  'UNKNOWN',
]);
export type ComplianceStatus = z.infer<typeof ComplianceStatus>;

export interface ComplianceCheck {
  id: string;
  walletAddress: string;
  jurisdiction: JurisdictionCode;
  status: ComplianceStatus;
  score: number; // 0-100
  checkedAt: Date;
  validUntil: Date;
  checks: ComplianceCheckItem[];
  summary: string;
}

export interface ComplianceCheckItem {
  name: string;
  description: string;
  status: ComplianceStatus;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  details?: string;
  recommendation?: string;
}

export interface ComplianceRequirement {
  code: string;
  jurisdiction: JurisdictionCode;
  name: string;
  description: string;
  category: 'REPORTING' | 'TAX' | 'AML' | 'KYC' | 'REGULATORY';
  mandatory: boolean;
  threshold?: number;
  currency?: string;
  deadline?: string;
}

export interface ComplianceReport {
  id: string;
  walletAddress: string;
  jurisdiction: JurisdictionCode;
  period: {
    start: Date;
    end: Date;
  };
  overallStatus: ComplianceStatus;
  score: number;
  requirements: ComplianceRequirementStatus[];
  actions: ComplianceAction[];
  generatedAt: Date;
}

export interface ComplianceRequirementStatus {
  requirement: ComplianceRequirement;
  status: ComplianceStatus;
  progress: number; // 0-100
  details: string;
  dueDate?: Date;
}

export interface ComplianceAction {
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  type: string;
  description: string;
  deadline?: Date;
  estimatedImpact: string;
}

// Quick compliance check input/output
export const QuickComplianceCheckSchema = z.object({
  walletAddress: z.string(),
  jurisdiction: JurisdictionCode,
  taxYear: z.number().int().optional(),
});

export type QuickComplianceCheckInput = z.infer<typeof QuickComplianceCheckSchema>;

export interface QuickComplianceCheckResult {
  walletAddress: string;
  jurisdiction: JurisdictionCode;
  status: ComplianceStatus;
  score: number;
  summary: string;
  hasAttestation: boolean;
  attestationExpiry?: Date;
  lastAuditDate?: Date;
  recommendedActions: string[];
}
