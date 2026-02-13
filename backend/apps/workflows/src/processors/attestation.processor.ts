import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import {
  QUEUES,
  JOB_NAMES,
  AttestationJobData,
  RevokeAttestationJobData,
} from '@auditswarm/queue';
import { AttestationRepository } from '@auditswarm/database';
import {
  Connection,
  PublicKey,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
} from '@solana/web3.js';
import {
  getStatePDA,
  getAttestationPDA,
  Jurisdiction,
  AttestationType,
} from '../../../../../onchain/sdk/src';

// Program ID matching devnet deployment
const PROGRAM_ID = new PublicKey(
  '52LCg2VXDYgam4yHkXEp2vN2psUmo6Q7rv5efRm7ic8c',
);

// Instruction discriminators (from IDL)
const DISCRIMINATORS = {
  createAttestation: Buffer.from([49, 24, 67, 80, 12, 249, 96, 239]),
  revokeAttestation: Buffer.from([12, 156, 103, 161, 194, 246, 211, 179]),
};

@Processor(QUEUES.ATTESTATION)
export class AttestationProcessor extends WorkerHost {
  private readonly logger = new Logger(AttestationProcessor.name);

  constructor(
    private attestationRepository: AttestationRepository,
    private configService: ConfigService,
  ) {
    super();
  }

  async process(
    job: Job<AttestationJobData | RevokeAttestationJobData>,
  ): Promise<void> {
    switch (job.name) {
      case JOB_NAMES.REVOKE_ATTESTATION:
        return this.processRevoke(job as Job<RevokeAttestationJobData>);
      case JOB_NAMES.CREATE_ATTESTATION:
      default:
        return this.processCreate(job as Job<AttestationJobData>);
    }
  }

  // ─── Create Attestation ─────────────────────────────────────────────

  private async processCreate(job: Job<AttestationJobData>): Promise<void> {
    const {
      attestationId,
      walletAddresses,
      jurisdiction,
      type,
      taxYear,
      hash,
      expiresAt,
    } = job.data;

    this.logger.log(
      `Creating on-chain attestation ${attestationId} for ${walletAddresses.length} wallet(s)`,
    );

    try {
      const { connection, authority } = this.getSolanaContext();

      if (!authority) {
        this.logger.warn(
          'SOLANA_AUTHORITY_KEY not set — cannot create on-chain attestation',
        );
        await this.setFailed(
          attestationId,
          'SOLANA_AUTHORITY_KEY not configured',
        );
        return;
      }

      const walletPubkeys = walletAddresses.map(
        (addr) => new PublicKey(addr),
      );
      const jurisdictionEnum = this.mapJurisdiction(jurisdiction);
      const attestationTypeEnum = this.mapAttestationType(type);

      // Derive PDAs
      const [statePDA] = getStatePDA(PROGRAM_ID);
      const hashBytes = Buffer.from(hash, 'hex').slice(0, 32);
      const [attestationPDA] = getAttestationPDA(hashBytes, PROGRAM_ID);

      // Build instruction data
      const expiresAtTimestamp = BigInt(
        Math.floor(new Date(expiresAt).getTime() / 1000),
      );

      const walletsDataSize = 4 + walletPubkeys.length * 32;
      const data = Buffer.alloc(8 + 1 + 1 + 2 + 32 + 8 + walletsDataSize);
      let offset = 0;

      DISCRIMINATORS.createAttestation.copy(data, offset);
      offset += 8;
      data.writeUInt8(jurisdictionEnum, offset);
      offset += 1;
      data.writeUInt8(attestationTypeEnum, offset);
      offset += 1;
      data.writeUInt16LE(taxYear, offset);
      offset += 2;
      hashBytes.copy(data, offset);
      offset += 32;
      data.writeBigInt64LE(expiresAtTimestamp, offset);
      offset += 8;
      data.writeUInt32LE(walletPubkeys.length, offset);
      offset += 4;
      for (const pubkey of walletPubkeys) {
        pubkey.toBuffer().copy(data, offset);
        offset += 32;
      }

      // Account order per Anchor IDL: state, attestation, authority, system_program
      const ix = {
        programId: PROGRAM_ID,
        keys: [
          { pubkey: statePDA, isSigner: false, isWritable: true },
          { pubkey: attestationPDA, isSigner: false, isWritable: true },
          {
            pubkey: authority.publicKey,
            isSigner: true,
            isWritable: true,
          },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
        ],
        data,
      };

      const signature = await this.sendTransaction(connection, authority, ix);

      // Get transaction details for slot/blockTime
      const txInfo = await connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });

      await this.attestationRepository.setOnChainData(attestationId, {
        account: attestationPDA.toBase58(),
        signature,
        slot: BigInt(txInfo?.slot ?? 0),
        blockTime: BigInt(
          txInfo?.blockTime ?? Math.floor(Date.now() / 1000),
        ),
      });

      await job.updateProgress(100);
      this.logger.log(
        `Attestation ${attestationId} created on-chain: ${signature}`,
      );
    } catch (error) {
      this.logger.error(
        `Attestation ${attestationId} create failed: ${error}`,
      );
      await this.setFailed(
        attestationId,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  // ─── Revoke Attestation ─────────────────────────────────────────────

  private async processRevoke(
    job: Job<RevokeAttestationJobData>,
  ): Promise<void> {
    const { attestationId, hash, reason } = job.data;

    this.logger.log(
      `Revoking on-chain attestation ${attestationId}: ${reason}`,
    );

    try {
      const { connection, authority } = this.getSolanaContext();

      if (!authority) {
        this.logger.warn(
          'SOLANA_AUTHORITY_KEY not set — cannot revoke on-chain attestation',
        );
        return;
      }

      // Derive PDAs
      const [statePDA] = getStatePDA(PROGRAM_ID);
      const hashBytes = Buffer.from(hash, 'hex').slice(0, 32);
      const [attestationPDA] = getAttestationPDA(hashBytes, PROGRAM_ID);

      // revoke_attestation takes no arguments — just the 8-byte discriminator
      const ix = {
        programId: PROGRAM_ID,
        keys: [
          { pubkey: statePDA, isSigner: false, isWritable: false },
          { pubkey: attestationPDA, isSigner: false, isWritable: true },
          {
            pubkey: authority.publicKey,
            isSigner: true,
            isWritable: false,
          },
        ],
        data: DISCRIMINATORS.revokeAttestation,
      };

      const signature = await this.sendTransaction(connection, authority, ix);

      this.logger.log(
        `Attestation ${attestationId} revoked on-chain: ${signature}`,
      );
    } catch (error) {
      // DB already marked REVOKED — on-chain revocation is best-effort
      this.logger.error(
        `Attestation ${attestationId} on-chain revoke failed: ${error}`,
      );
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private getSolanaContext(): {
    connection: Connection;
    authority: Keypair | null;
  } {
    const rpcUrl = this.configService.get<string>(
      'SOLANA_RPC_URL',
      'https://api.devnet.solana.com',
    );
    const connection = new Connection(rpcUrl, 'confirmed');

    const authorityKey =
      this.configService.get<string>('SOLANA_AUTHORITY_KEY');
    if (!authorityKey) {
      return { connection, authority: null };
    }

    const authority = Keypair.fromSecretKey(
      Buffer.from(JSON.parse(authorityKey)),
    );
    return { connection, authority };
  }

  private async sendTransaction(
    connection: Connection,
    authority: Keypair,
    ix: {
      programId: PublicKey;
      keys: Array<{
        pubkey: PublicKey;
        isSigner: boolean;
        isWritable: boolean;
      }>;
      data: Buffer;
    },
  ): Promise<string> {
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();

    const message = new TransactionMessage({
      payerKey: authority.publicKey,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([authority]);

    const signature = await connection.sendTransaction(tx, {
      skipPreflight: false,
    });

    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    });

    return signature;
  }

  private async setFailed(
    attestationId: string,
    errorMessage: string,
  ): Promise<void> {
    try {
      await this.attestationRepository.update(attestationId, {
        status: 'FAILED',
      });
    } catch (updateError) {
      this.logger.error(
        `Failed to update attestation ${attestationId} status: ${updateError}`,
      );
    }
  }

  private mapJurisdiction(code: string): Jurisdiction {
    switch (code) {
      case 'US':
        return Jurisdiction.US;
      case 'EU':
        return Jurisdiction.EU;
      case 'BR':
        return Jurisdiction.BR;
      case 'UK':
        return Jurisdiction.UK;
      case 'JP':
        return Jurisdiction.JP;
      case 'AU':
        return Jurisdiction.AU;
      case 'CA':
        return Jurisdiction.CA;
      case 'CH':
        return Jurisdiction.CH;
      case 'SG':
        return Jurisdiction.SG;
      default:
        return Jurisdiction.US;
    }
  }

  private mapAttestationType(type: string): AttestationType {
    switch (type) {
      case 'TAX_COMPLIANCE':
        return AttestationType.TaxCompliance;
      case 'AUDIT_COMPLETE':
        return AttestationType.AuditComplete;
      case 'REPORTING_COMPLETE':
        return AttestationType.ReportingComplete;
      case 'QUARTERLY_REVIEW':
        return AttestationType.QuarterlyReview;
      case 'ANNUAL_REVIEW':
        return AttestationType.AnnualReview;
      default:
        return AttestationType.TaxCompliance;
    }
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.log(`Attestation job ${job.id} (${job.name}) started`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Attestation job ${job.id} (${job.name}) completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `Attestation job ${job.id} (${job.name}) failed: ${error.message}`,
    );
  }
}
