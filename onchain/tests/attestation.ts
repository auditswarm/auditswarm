import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { Attestation } from "../target/types/attestation";

describe("attestation", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Attestation as Program<Attestation>;
  const authority = provider.wallet;

  // PDA helpers
  const findStatePda = () =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("state")],
      program.programId
    );

  const findAttestationPda = (auditHash: number[]) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("attestation"), Buffer.from(auditHash)],
      program.programId
    );

  // Helper to create a unique 32-byte audit hash
  let hashCounter = 0;
  const makeAuditHash = (): number[] => {
    const hash = new Array(32).fill(0);
    const counterBytes = Buffer.alloc(4);
    counterBytes.writeUInt32LE(++hashCounter);
    for (let i = 0; i < 4; i++) hash[i] = counterBytes[i];
    return hash;
  };

  // Helper to create an attestation with defaults
  const createAttestation = async (
    overrides: {
      jurisdiction?: any;
      attestationType?: any;
      taxYear?: number;
      auditHash?: number[];
      expiresAt?: anchor.BN;
      wallets?: PublicKey[];
      signers?: Keypair[];
      authorityPubkey?: PublicKey;
    } = {}
  ) => {
    const auditHash = overrides.auditHash ?? makeAuditHash();
    const wallets = overrides.wallets ?? [Keypair.generate().publicKey];
    const [statePda] = findStatePda();
    const [attestationPda] = findAttestationPda(auditHash);
    const expiresAt =
      overrides.expiresAt ?? new anchor.BN(Math.floor(Date.now() / 1000) + 86400 * 365);

    const accounts: any = {
      state: statePda,
      attestation: attestationPda,
      authority: overrides.authorityPubkey ?? authority.publicKey,
      systemProgram: SystemProgram.programId,
    };

    const builder = program.methods
      .createAttestation(
        overrides.jurisdiction ?? { us: {} },
        overrides.attestationType ?? { taxCompliance: {} },
        overrides.taxYear ?? 2025,
        auditHash,
        expiresAt,
        wallets
      )
      .accounts(accounts);

    if (overrides.signers) {
      builder.signers(overrides.signers);
    }

    const tx = await builder.rpc();
    return { tx, attestationPda, auditHash, wallets, expiresAt };
  };

  // ============================================
  // Initialize
  // ============================================

  describe("initialize", () => {
    it("initializes program state", async () => {
      const [statePda, bump] = findStatePda();

      await program.methods
        .initialize()
        .accounts({
          state: statePda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const state = await program.account.programState.fetch(statePda);
      expect(state.authority.toBase58()).to.equal(authority.publicKey.toBase58());
      expect(state.attestationCount.toNumber()).to.equal(0);
      expect(state.bump).to.equal(bump);
    });

    it("fails to initialize twice", async () => {
      const [statePda] = findStatePda();

      try {
        await program.methods
          .initialize()
          .accounts({
            state: statePda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        // Account already initialized - Anchor returns a SendTransactionError
        expect(err).to.exist;
      }
    });
  });

  // ============================================
  // Create Attestation
  // ============================================

  describe("create_attestation", () => {
    it("creates attestation with a single wallet", async () => {
      const wallet1 = Keypair.generate().publicKey;
      const auditHash = makeAuditHash();
      const expiresAt = new anchor.BN(Math.floor(Date.now() / 1000) + 86400 * 365);

      const { attestationPda } = await createAttestation({
        jurisdiction: { us: {} },
        attestationType: { taxCompliance: {} },
        taxYear: 2025,
        auditHash,
        expiresAt,
        wallets: [wallet1],
      });

      const attestation = await program.account.attestation.fetch(attestationPda);
      expect(attestation.authority.toBase58()).to.equal(authority.publicKey.toBase58());
      expect(attestation.jurisdiction).to.deep.equal({ us: {} });
      expect(attestation.attestationType).to.deep.equal({ taxCompliance: {} });
      expect(JSON.stringify(attestation.status)).to.equal(JSON.stringify({ active: {} }));
      expect(attestation.taxYear).to.equal(2025);
      expect(attestation.auditHash).to.deep.equal(auditHash);
      expect(attestation.expiresAt.toNumber()).to.equal(expiresAt.toNumber());
      expect(attestation.issuedAt.toNumber()).to.be.greaterThan(0);
      expect(attestation.revokedAt.toNumber()).to.equal(0);
      expect(attestation.numWallets).to.equal(1);
      expect(attestation.wallets.length).to.equal(1);
      expect(attestation.wallets[0].toBase58()).to.equal(wallet1.toBase58());
    });

    it("creates attestation with multiple wallets (3)", async () => {
      const wallets = [
        Keypair.generate().publicKey,
        Keypair.generate().publicKey,
        Keypair.generate().publicKey,
      ];

      const { attestationPda } = await createAttestation({ wallets });

      const attestation = await program.account.attestation.fetch(attestationPda);
      expect(attestation.numWallets).to.equal(3);
      expect(attestation.wallets.length).to.equal(3);
      for (let i = 0; i < 3; i++) {
        expect(attestation.wallets[i].toBase58()).to.equal(wallets[i].toBase58());
      }
    });

    it("creates attestation with max wallets (10)", async () => {
      const wallets = Array.from({ length: 10 }, () => Keypair.generate().publicKey);

      const { attestationPda } = await createAttestation({ wallets });

      const attestation = await program.account.attestation.fetch(attestationPda);
      expect(attestation.numWallets).to.equal(10);
      expect(attestation.wallets.length).to.equal(10);
      for (let i = 0; i < 10; i++) {
        expect(attestation.wallets[i].toBase58()).to.equal(wallets[i].toBase58());
      }
    });

    it("fails with 0 wallets", async () => {
      try {
        await createAttestation({ wallets: [] });
        expect.fail("should have thrown");
      } catch (err: any) {
        const errMsg = err.toString();
        expect(errMsg).to.contain("InvalidWalletCount");
      }
    });

    it("fails with 11 wallets (exceeds max)", async () => {
      const wallets = Array.from({ length: 11 }, () => Keypair.generate().publicKey);
      try {
        await createAttestation({ wallets });
        expect.fail("should have thrown");
      } catch (err: any) {
        const errMsg = err.toString();
        expect(errMsg).to.contain("InvalidWalletCount");
      }
    });

    it("fails with wrong authority", async () => {
      const fakeAuthority = Keypair.generate();

      // Airdrop SOL to fake authority so it can pay
      const sig = await provider.connection.requestAirdrop(
        fakeAuthority.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const auditHash = makeAuditHash();
      const [statePda] = findStatePda();
      const [attestationPda] = findAttestationPda(auditHash);

      try {
        await program.methods
          .createAttestation(
            { us: {} },
            { taxCompliance: {} },
            2025,
            auditHash,
            new anchor.BN(Math.floor(Date.now() / 1000) + 86400),
            [Keypair.generate().publicKey]
          )
          .accounts({
            state: statePda,
            attestation: attestationPda,
            authority: fakeAuthority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([fakeAuthority])
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        const errMsg = err.toString();
        expect(errMsg).to.contain("Unauthorized");
      }
    });

    it("fails with duplicate audit_hash", async () => {
      const auditHash = makeAuditHash();
      await createAttestation({ auditHash });

      try {
        await createAttestation({ auditHash });
        expect.fail("should have thrown");
      } catch (err: any) {
        // Anchor will fail because the PDA account already exists
        expect(err).to.exist;
      }
    });

    it("creates attestations for different jurisdictions", async () => {
      const jurisdictions = [
        { us: {} },
        { eu: {} },
        { br: {} },
        { uk: {} },
        { jp: {} },
      ];

      for (const jurisdiction of jurisdictions) {
        const { attestationPda } = await createAttestation({ jurisdiction });
        const attestation = await program.account.attestation.fetch(attestationPda);
        expect(attestation.jurisdiction).to.deep.equal(jurisdiction);
      }
    });

    it("creates attestations with different types", async () => {
      const types = [
        { taxCompliance: {} },
        { auditComplete: {} },
        { reportingComplete: {} },
        { quarterlyReview: {} },
        { annualReview: {} },
      ];

      for (const attestationType of types) {
        const { attestationPda } = await createAttestation({ attestationType });
        const attestation = await program.account.attestation.fetch(attestationPda);
        expect(attestation.attestationType).to.deep.equal(attestationType);
      }
    });

    it("increments attestation_count correctly", async () => {
      const [statePda] = findStatePda();
      const stateBefore = await program.account.programState.fetch(statePda);
      const countBefore = stateBefore.attestationCount.toNumber();

      await createAttestation();
      await createAttestation();
      await createAttestation();

      const stateAfter = await program.account.programState.fetch(statePda);
      expect(stateAfter.attestationCount.toNumber()).to.equal(countBefore + 3);
    });
  });

  // ============================================
  // PDA Derivation
  // ============================================

  describe("PDA derivation", () => {
    it("verifies PDA address matches expected derivation", async () => {
      const auditHash = makeAuditHash();
      const [expectedPda, expectedBump] = findAttestationPda(auditHash);

      const { attestationPda } = await createAttestation({ auditHash });

      expect(attestationPda.toBase58()).to.equal(expectedPda.toBase58());

      const attestation = await program.account.attestation.fetch(attestationPda);
      expect(attestation.bump).to.equal(expectedBump);
    });

    it("verifies state PDA address", async () => {
      const [expectedStatePda, expectedBump] = findStatePda();
      const state = await program.account.programState.fetch(expectedStatePda);
      expect(state.bump).to.equal(expectedBump);
    });
  });

  // ============================================
  // Update Status
  // ============================================

  describe("update_status", () => {
    it("updates status from Active to Expired", async () => {
      const { attestationPda, auditHash } = await createAttestation();
      const [statePda] = findStatePda();

      await program.methods
        .updateStatus({ expired: {} })
        .accounts({
          state: statePda,
          attestation: attestationPda,
          authority: authority.publicKey,
        })
        .rpc();

      const attestation = await program.account.attestation.fetch(attestationPda);
      expect(JSON.stringify(attestation.status)).to.equal(JSON.stringify({ expired: {} }));
      // revoked_at should remain 0 for expired status
      expect(attestation.revokedAt.toNumber()).to.equal(0);
    });

    it("updates status from Active to Revoked (sets revoked_at)", async () => {
      const { attestationPda } = await createAttestation();
      const [statePda] = findStatePda();

      await program.methods
        .updateStatus({ revoked: {} })
        .accounts({
          state: statePda,
          attestation: attestationPda,
          authority: authority.publicKey,
        })
        .rpc();

      const attestation = await program.account.attestation.fetch(attestationPda);
      expect(JSON.stringify(attestation.status)).to.equal(JSON.stringify({ revoked: {} }));
      expect(attestation.revokedAt.toNumber()).to.be.greaterThan(0);
    });

    it("fails for invalid transition Active -> Pending", async () => {
      const { attestationPda } = await createAttestation();
      const [statePda] = findStatePda();

      try {
        await program.methods
          .updateStatus({ pending: {} })
          .accounts({
            state: statePda,
            attestation: attestationPda,
            authority: authority.publicKey,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        const errMsg = err.toString();
        expect(errMsg).to.contain("InvalidStatusTransition");
      }
    });

    it("fails for invalid transition Expired -> Active", async () => {
      const { attestationPda } = await createAttestation();
      const [statePda] = findStatePda();

      // First transition to Expired
      await program.methods
        .updateStatus({ expired: {} })
        .accounts({
          state: statePda,
          attestation: attestationPda,
          authority: authority.publicKey,
        })
        .rpc();

      // Try invalid transition Expired -> Active
      try {
        await program.methods
          .updateStatus({ active: {} })
          .accounts({
            state: statePda,
            attestation: attestationPda,
            authority: authority.publicKey,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        const errMsg = err.toString();
        expect(errMsg).to.contain("InvalidStatusTransition");
      }
    });

    it("fails to update status on revoked attestation", async () => {
      const { attestationPda } = await createAttestation();
      const [statePda] = findStatePda();

      // Revoke it first
      await program.methods
        .revokeAttestation()
        .accounts({
          state: statePda,
          attestation: attestationPda,
          authority: authority.publicKey,
        })
        .rpc();

      // Try to update status on revoked attestation
      try {
        await program.methods
          .updateStatus({ expired: {} })
          .accounts({
            state: statePda,
            attestation: attestationPda,
            authority: authority.publicKey,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        const errMsg = err.toString();
        expect(errMsg).to.contain("InvalidStatusTransition");
      }
    });

    it("fails with wrong authority", async () => {
      const fakeAuthority = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        fakeAuthority.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const { attestationPda } = await createAttestation();
      const [statePda] = findStatePda();

      try {
        await program.methods
          .updateStatus({ expired: {} })
          .accounts({
            state: statePda,
            attestation: attestationPda,
            authority: fakeAuthority.publicKey,
          })
          .signers([fakeAuthority])
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        const errMsg = err.toString();
        expect(errMsg).to.contain("Unauthorized");
      }
    });
  });

  // ============================================
  // Revoke Attestation
  // ============================================

  describe("revoke_attestation", () => {
    it("revokes an active attestation", async () => {
      const { attestationPda } = await createAttestation();
      const [statePda] = findStatePda();

      await program.methods
        .revokeAttestation()
        .accounts({
          state: statePda,
          attestation: attestationPda,
          authority: authority.publicKey,
        })
        .rpc();

      const attestation = await program.account.attestation.fetch(attestationPda);
      expect(JSON.stringify(attestation.status)).to.equal(JSON.stringify({ revoked: {} }));
      expect(attestation.revokedAt.toNumber()).to.be.greaterThan(0);
    });

    it("preserves wallet data after revocation", async () => {
      const wallets = [
        Keypair.generate().publicKey,
        Keypair.generate().publicKey,
      ];
      const { attestationPda } = await createAttestation({ wallets });
      const [statePda] = findStatePda();

      await program.methods
        .revokeAttestation()
        .accounts({
          state: statePda,
          attestation: attestationPda,
          authority: authority.publicKey,
        })
        .rpc();

      const attestation = await program.account.attestation.fetch(attestationPda);
      expect(attestation.wallets.length).to.equal(2);
      expect(attestation.wallets[0].toBase58()).to.equal(wallets[0].toBase58());
      expect(attestation.wallets[1].toBase58()).to.equal(wallets[1].toBase58());
    });

    it("fails to revoke an already revoked attestation", async () => {
      const { attestationPda } = await createAttestation();
      const [statePda] = findStatePda();

      // Revoke once
      await program.methods
        .revokeAttestation()
        .accounts({
          state: statePda,
          attestation: attestationPda,
          authority: authority.publicKey,
        })
        .rpc();

      // Try to revoke again
      try {
        await program.methods
          .revokeAttestation()
          .accounts({
            state: statePda,
            attestation: attestationPda,
            authority: authority.publicKey,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        const errMsg = err.toString();
        expect(errMsg).to.contain("AttestationNotActive");
      }
    });

    it("fails to revoke an expired attestation", async () => {
      const { attestationPda } = await createAttestation();
      const [statePda] = findStatePda();

      // Expire it first
      await program.methods
        .updateStatus({ expired: {} })
        .accounts({
          state: statePda,
          attestation: attestationPda,
          authority: authority.publicKey,
        })
        .rpc();

      // Try to revoke
      try {
        await program.methods
          .revokeAttestation()
          .accounts({
            state: statePda,
            attestation: attestationPda,
            authority: authority.publicKey,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        const errMsg = err.toString();
        expect(errMsg).to.contain("AttestationNotActive");
      }
    });

    it("fails with wrong authority", async () => {
      const fakeAuthority = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        fakeAuthority.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const { attestationPda } = await createAttestation();
      const [statePda] = findStatePda();

      try {
        await program.methods
          .revokeAttestation()
          .accounts({
            state: statePda,
            attestation: attestationPda,
            authority: fakeAuthority.publicKey,
          })
          .signers([fakeAuthority])
          .rpc();
        expect.fail("should have thrown");
      } catch (err: any) {
        const errMsg = err.toString();
        expect(errMsg).to.contain("Unauthorized");
      }
    });
  });
});
