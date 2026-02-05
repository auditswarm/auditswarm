import type { Jurisdiction, JurisdictionCode } from '../types/jurisdiction';

export const JURISDICTIONS: Record<JurisdictionCode, Jurisdiction> = {
  US: {
    code: 'US',
    name: 'United States',
    currency: 'USD',
    taxYear: {
      start: { month: 1, day: 1 },
      end: { month: 12, day: 31 },
    },
    features: {
      capitalGains: true,
      income: true,
      mining: true,
      staking: true,
      airdrops: true,
      nfts: true,
      defi: true,
    },
    reportFormats: ['Form 8949', 'Schedule D', 'FBAR', 'Form 8938'],
  },
  EU: {
    code: 'EU',
    name: 'European Union',
    currency: 'EUR',
    taxYear: {
      start: { month: 1, day: 1 },
      end: { month: 12, day: 31 },
    },
    features: {
      capitalGains: true,
      income: true,
      mining: true,
      staking: true,
      airdrops: true,
      nfts: true,
      defi: true,
    },
    reportFormats: ['MiCA Report', 'DAC8', 'Travel Rule Report'],
  },
  BR: {
    code: 'BR',
    name: 'Brazil',
    currency: 'BRL',
    taxYear: {
      start: { month: 1, day: 1 },
      end: { month: 12, day: 31 },
    },
    features: {
      capitalGains: true,
      income: true,
      mining: true,
      staking: true,
      airdrops: true,
      nfts: true,
      defi: true,
    },
    reportFormats: ['IN 1888', 'GCAP', 'DIRPF'],
  },
  UK: {
    code: 'UK',
    name: 'United Kingdom',
    currency: 'GBP',
    taxYear: {
      start: { month: 4, day: 6 },
      end: { month: 4, day: 5 },
    },
    features: {
      capitalGains: true,
      income: true,
      mining: true,
      staking: true,
      airdrops: true,
      nfts: true,
      defi: true,
    },
    reportFormats: ['Self Assessment', 'Capital Gains Summary'],
  },
  JP: {
    code: 'JP',
    name: 'Japan',
    currency: 'JPY',
    taxYear: {
      start: { month: 1, day: 1 },
      end: { month: 12, day: 31 },
    },
    features: {
      capitalGains: true,
      income: true,
      mining: true,
      staking: true,
      airdrops: true,
      nfts: true,
      defi: true,
    },
    reportFormats: ['Kokuzei Report', 'Crypto Income Declaration'],
  },
  AU: {
    code: 'AU',
    name: 'Australia',
    currency: 'AUD',
    taxYear: {
      start: { month: 7, day: 1 },
      end: { month: 6, day: 30 },
    },
    features: {
      capitalGains: true,
      income: true,
      mining: true,
      staking: true,
      airdrops: true,
      nfts: true,
      defi: true,
    },
    reportFormats: ['CGT Schedule', 'myTax Report'],
  },
  CA: {
    code: 'CA',
    name: 'Canada',
    currency: 'CAD',
    taxYear: {
      start: { month: 1, day: 1 },
      end: { month: 12, day: 31 },
    },
    features: {
      capitalGains: true,
      income: true,
      mining: true,
      staking: true,
      airdrops: true,
      nfts: true,
      defi: true,
    },
    reportFormats: ['Schedule 3', 'T1135'],
  },
  CH: {
    code: 'CH',
    name: 'Switzerland',
    currency: 'CHF',
    taxYear: {
      start: { month: 1, day: 1 },
      end: { month: 12, day: 31 },
    },
    features: {
      capitalGains: true,
      income: true,
      mining: true,
      staking: true,
      airdrops: true,
      nfts: true,
      defi: true,
    },
    reportFormats: ['Wealth Declaration', 'Cantonal Tax Form'],
  },
  SG: {
    code: 'SG',
    name: 'Singapore',
    currency: 'SGD',
    taxYear: {
      start: { month: 1, day: 1 },
      end: { month: 12, day: 31 },
    },
    features: {
      capitalGains: false, // No capital gains tax in Singapore
      income: true,
      mining: true,
      staking: true,
      airdrops: true,
      nfts: true,
      defi: true,
    },
    reportFormats: ['Form B/B1', 'Business Income Declaration'],
  },
};

export const SUPPORTED_JURISDICTIONS: JurisdictionCode[] = ['US', 'EU', 'BR'];

export function getJurisdiction(code: JurisdictionCode): Jurisdiction {
  return JURISDICTIONS[code];
}

export function isJurisdictionSupported(code: string): code is JurisdictionCode {
  return SUPPORTED_JURISDICTIONS.includes(code as JurisdictionCode);
}
