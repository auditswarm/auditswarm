import { Injectable, Logger } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';

@Injectable()
export class ATAResolverService {
  private readonly logger = new Logger(ATAResolverService.name);
  private readonly cache = new Map<string, string>();

  /**
   * Resolve a token account address to its owner wallet.
   * Helius Enhanced already provides fromUserAccount/toUserAccount (owners),
   * so this is primarily a fallback for edge cases.
   */
  resolveToOwner(ataAddress: string): string | null {
    if (this.cache.has(ataAddress)) {
      return this.cache.get(ataAddress)!;
    }
    // Can't derive owner from ATA address alone without on-chain lookup.
    // ATAs are deterministic: ATA = f(owner, mint) but you need both to verify.
    // This fallback returns null — caller should use Helius userAccount fields.
    return null;
  }

  /**
   * Derive ATA address for a given owner + mint. Cache the reverse mapping.
   */
  deriveATA(owner: string, mint: string): string {
    try {
      const ownerPk = new PublicKey(owner);
      const mintPk = new PublicKey(mint);
      const ata = getAssociatedTokenAddressSync(mintPk, ownerPk, true, TOKEN_PROGRAM_ID);
      const ataStr = ata.toBase58();
      this.cache.set(ataStr, owner);
      return ataStr;
    } catch (error) {
      this.logger.warn(`Failed to derive ATA for owner=${owner} mint=${mint}: ${error}`);
      return owner; // fallback to owner
    }
  }

  /**
   * Register a known ATA->owner mapping (from Helius Enhanced data).
   */
  registerMapping(ataAddress: string, ownerAddress: string): void {
    this.cache.set(ataAddress, ownerAddress);
  }

  /**
   * Resolve address to owner — use cache first, return address itself if unknown.
   * Helius Enhanced already resolves ATAs to owners, so most addresses will be owners.
   */
  resolveAddress(address: string): string {
    return this.cache.get(address) ?? address;
  }
}
