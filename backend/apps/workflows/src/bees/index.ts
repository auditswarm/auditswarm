export { BaseBee, type JurisdictionBee, type BeeOptions, type BeeResult } from './base';
export { USBee } from './us';
export { EUBee } from './eu';
export { BRBee } from './br';

import { JurisdictionBee } from './base';
import { USBee } from './us';
import { EUBee } from './eu';
import { BRBee } from './br';
import type { JurisdictionCode } from '@auditswarm/common';

/**
 * Get the appropriate bee for a jurisdiction
 */
export function getBee(jurisdiction: JurisdictionCode): JurisdictionBee {
  switch (jurisdiction) {
    case 'US':
      return new USBee();
    case 'EU':
      return new EUBee();
    case 'BR':
      return new BRBee();
    default:
      throw new Error(`Unsupported jurisdiction: ${jurisdiction}`);
  }
}

/**
 * List all supported jurisdictions with their bees
 */
export function getSupportedJurisdictions(): { code: JurisdictionCode; name: string; version: string }[] {
  return [
    { code: 'US', name: 'US Tax Compliance Bee', version: '1.0.0' },
    { code: 'EU', name: 'EU/MiCA Compliance Bee', version: '1.0.0' },
    { code: 'BR', name: 'Brazil Tax Compliance Bee', version: '1.0.0' },
  ];
}
