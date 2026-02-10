import { Injectable, Logger } from '@nestjs/common';
import { mapHeliusType } from '../constants/helius-type-map';
import { getKnownProgram } from '../constants/known-programs';
import { ATAResolverService } from './ata-resolver.service';

export interface ParsedResult {
  transaction: {
    signature: string;
    type: string;
    status: string;
    timestamp: Date;
    slot: number;
    blockTime: number;
    fee: bigint;
    feePayer: string;
    totalValueUsd?: number;
    transfers: TransferInfo[];
    rawData: any;
  };
  enrichment: {
    protocolName?: string;
    protocolProgramId?: string;
    heliusType: string;
    heliusSource?: string;
    swapDetails?: any;
    stakingDetails?: any;
    defiDetails?: any;
    isUnknown: boolean;
    isFailed: boolean;
  };
  /** All addresses involved (for counterparty tracking) */
  involvedAddresses: string[];
  /** Mints involved (for token metadata resolution) */
  involvedMints: string[];
}

export interface TransferInfo {
  mint: string;
  amount: number;
  direction: 'IN' | 'OUT';
  from: string;
  to: string;
  fromUserAccount?: string;
  toUserAccount?: string;
}

@Injectable()
export class TransactionParserService {
  private readonly logger = new Logger(TransactionParserService.name);

  constructor(private ataResolver: ATAResolverService) {}

  parse(heliusTx: any, walletAddress: string): ParsedResult | null {
    try {
      const heliusType: string = heliusTx.type ?? 'UNKNOWN';
      const mapping = mapHeliusType(heliusType);

      // Skip NFT types in MVP
      if (mapping.txType === null) {
        return null;
      }

      const isFailed = heliusTx.transactionError != null;
      const timestamp = new Date((heliusTx.timestamp ?? 0) * 1000);
      const slot = heliusTx.slot ?? 0;
      const fee = BigInt(heliusTx.fee ?? 0);
      const feePayer = heliusTx.feePayer ?? '';

      // Extract transfers
      const transfers = this.extractTransfers(heliusTx, walletAddress);
      const involvedMints = this.extractMints(transfers);

      // Determine transaction type
      let txType = mapping.txType!;

      // Direction-based resolution for transfers
      if (mapping.directionBased) {
        txType = this.resolveTransferDirection(transfers, walletAddress);
      }

      // Override from known programs
      const programOverride = this.resolveProgramType(heliusTx);
      if (programOverride) {
        txType = programOverride.txType ?? txType;
      }

      // LP detection: known LP programs (e.g. Meteora DLMM) don't set txType,
      // so we detect LP_DEPOSIT vs LP_WITHDRAW from transfer directions
      if (programOverride?.entityType === 'LP' && !programOverride.txType) {
        const hasOut = transfers.some(t => t.direction === 'OUT');
        const hasIn = transfers.some(t => t.direction === 'IN');
        if (hasOut && !hasIn) txType = 'LP_DEPOSIT';
        else if (hasIn && !hasOut) txType = 'LP_WITHDRAW';
        else if (hasOut && hasIn) txType = 'LP_DEPOSIT'; // rebalance
      }

      // Extract counterparty addresses (only for transfer types)
      const involvedAddresses = this.extractAddresses(heliusTx, walletAddress, txType);

      // Build enrichment details
      const enrichment = this.buildEnrichment(heliusTx, heliusType, txType, programOverride);

      // Calculate total value
      const totalValueUsd = this.calculateTotalValue(transfers);

      return {
        transaction: {
          signature: heliusTx.signature,
          type: txType,
          status: isFailed ? 'FAILED' : 'CONFIRMED',
          timestamp,
          slot,
          blockTime: heliusTx.timestamp ?? 0,
          fee,
          feePayer,
          totalValueUsd,
          transfers,
          rawData: heliusTx,
        },
        enrichment: {
          ...enrichment,
          heliusType,
          heliusSource: heliusTx.source,
          isUnknown: txType === 'UNKNOWN',
          isFailed,
        },
        involvedAddresses,
        involvedMints,
      };
    } catch (error) {
      this.logger.error(`Failed to parse tx ${heliusTx?.signature}: ${error}`);
      return null;
    }
  }

  private extractTransfers(heliusTx: any, walletAddress: string): TransferInfo[] {
    const transfers: TransferInfo[] = [];

    // Native SOL transfers
    const nativeTransfers = heliusTx.nativeTransfers ?? [];
    for (const nt of nativeTransfers) {
      const from = this.ataResolver.resolveAddress(nt.fromUserAccount ?? nt.from ?? '');
      const to = this.ataResolver.resolveAddress(nt.toUserAccount ?? nt.to ?? '');
      const amount = (nt.amount ?? 0) / 1e9; // lamports to SOL

      if (amount === 0) continue;

      const direction = to.toLowerCase() === walletAddress.toLowerCase() ? 'IN' : 'OUT';
      transfers.push({
        mint: 'So11111111111111111111111111111111111111112',
        amount,
        direction,
        from,
        to,
        fromUserAccount: nt.fromUserAccount,
        toUserAccount: nt.toUserAccount,
      });
    }

    // SPL token transfers
    const tokenTransfers = heliusTx.tokenTransfers ?? [];
    for (const tt of tokenTransfers) {
      const from = this.ataResolver.resolveAddress(tt.fromUserAccount ?? tt.fromTokenAccount ?? '');
      const to = this.ataResolver.resolveAddress(tt.toUserAccount ?? tt.toTokenAccount ?? '');
      const amount = tt.tokenAmount ?? 0;

      if (amount === 0) continue;

      // Register ATA mappings if available
      if (tt.fromTokenAccount && tt.fromUserAccount) {
        this.ataResolver.registerMapping(tt.fromTokenAccount, tt.fromUserAccount);
      }
      if (tt.toTokenAccount && tt.toUserAccount) {
        this.ataResolver.registerMapping(tt.toTokenAccount, tt.toUserAccount);
      }

      const direction = to.toLowerCase() === walletAddress.toLowerCase() ? 'IN' : 'OUT';
      transfers.push({
        mint: tt.mint ?? '',
        amount,
        direction,
        from,
        to,
        fromUserAccount: tt.fromUserAccount,
        toUserAccount: tt.toUserAccount,
      });
    }

    return transfers;
  }

  private resolveTransferDirection(transfers: TransferInfo[], walletAddress: string): string {
    // Only consider transfers where the user's wallet is directly involved.
    // Multi-recipient transfers include legs between OTHER addresses that
    // would otherwise produce false IN+OUT = SWAP.
    const addr = walletAddress.toLowerCase();
    const relevant = transfers.filter(
      t => t.from.toLowerCase() === addr || t.to.toLowerCase() === addr,
    );

    if (relevant.length === 0) return 'UNKNOWN';

    const hasIn = relevant.some(t => t.to.toLowerCase() === addr);
    const hasOut = relevant.some(t => t.from.toLowerCase() === addr);

    if (hasIn && hasOut) return 'SWAP';
    if (hasIn) return 'TRANSFER_IN';
    if (hasOut) return 'TRANSFER_OUT';
    return 'UNKNOWN';
  }

  private resolveProgramType(heliusTx: any): { txType?: string; name: string; entityType: string; programId: string } | null {
    const instructions = heliusTx.instructions ?? [];
    for (const ix of instructions) {
      const programId = ix.programId ?? '';
      const known = getKnownProgram(programId);
      if (known && (known.txType || known.entityType === 'LP')) {
        return { ...known, programId };
      }
    }

    // Check accountData for program interactions
    const accountData = heliusTx.accountData ?? [];
    for (const ad of accountData) {
      const programId = ad.account ?? '';
      const known = getKnownProgram(programId);
      if (known && (known.txType || known.entityType === 'LP')) {
        return { ...known, programId };
      }
    }

    return null;
  }

  private buildEnrichment(
    heliusTx: any,
    heliusType: string,
    txType: string,
    programOverride: any | null,
  ): {
    protocolName?: string;
    protocolProgramId?: string;
    swapDetails?: any;
    stakingDetails?: any;
    defiDetails?: any;
  } {
    const enrichment: any = {};

    if (programOverride) {
      enrichment.protocolName = programOverride.name;
      enrichment.protocolProgramId = programOverride.programId;
    }

    if (txType === 'SWAP') {
      enrichment.swapDetails = {
        source: heliusTx.source,
        tokenInputs: heliusTx.tokenTransfers?.filter((t: any) => t.tokenAmount > 0) ?? [],
      };
    }

    if (txType === 'STAKE' || txType === 'UNSTAKE') {
      const isLiquid = programOverride && ['Marinade Finance', 'Jito Staking', 'BlazeStake'].includes(programOverride.name);
      enrichment.stakingDetails = {
        isLiquid: !!isLiquid,
        protocol: programOverride?.name ?? 'Native Staking',
        type: txType === 'STAKE' ? 'stake' : 'unstake',
      };
    }

    if (['LP_DEPOSIT', 'LP_WITHDRAW', 'LOAN_BORROW', 'LOAN_REPAY'].includes(txType)) {
      enrichment.defiDetails = {
        protocol: programOverride?.name,
        action: txType,
      };
    }

    return enrichment;
  }

  private extractAddresses(heliusTx: any, walletAddress: string, _txType: string): string[] {
    // Extract counterparty addresses from any transfer where the wallet is
    // directly involved (sender or receiver). This covers TRANSFER, UNKNOWN,
    // and any other type with real SOL/SPL movement to/from the wallet.
    // For SWAPs the counterparties will typically be DEX pools, which get
    // auto-labeled as programs by CounterpartyService.
    const addr = walletAddress.toLowerCase();
    const addresses = new Set<string>();

    for (const nt of heliusTx.nativeTransfers ?? []) {
      const from: string = nt.fromUserAccount ?? '';
      const to: string = nt.toUserAccount ?? '';
      const walletIsSender = from.toLowerCase() === addr;
      const walletIsReceiver = to.toLowerCase() === addr;
      if (!walletIsSender && !walletIsReceiver) continue;
      // Add the OTHER side as counterparty
      if (walletIsSender && to) addresses.add(to);
      if (walletIsReceiver && from) addresses.add(from);
    }

    for (const tt of heliusTx.tokenTransfers ?? []) {
      const from: string = tt.fromUserAccount ?? '';
      const to: string = tt.toUserAccount ?? '';
      const walletIsSender = from.toLowerCase() === addr;
      const walletIsReceiver = to.toLowerCase() === addr;
      if (!walletIsSender && !walletIsReceiver) continue;
      if (walletIsSender && to) addresses.add(to);
      if (walletIsReceiver && from) addresses.add(from);
    }

    // Remove the user's own wallet (in case of self-transfers)
    addresses.delete(walletAddress);

    return Array.from(addresses);
  }

  private extractMints(transfers: TransferInfo[]): string[] {
    const mints = new Set<string>();
    for (const t of transfers) {
      if (t.mint) mints.add(t.mint);
    }
    return Array.from(mints);
  }

  private calculateTotalValue(transfers: TransferInfo[]): number | undefined {
    // Value will be set later by PriceService
    return undefined;
  }
}
