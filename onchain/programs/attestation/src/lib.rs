use anchor_lang::prelude::*;

declare_id!("52LCg2VXDYgam4yHkXEp2vN2psUmo6Q7rv5efRm7ic8c");

#[program]
pub mod attestation {
    use super::*;

    /// Initialize the program state
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.authority = ctx.accounts.authority.key();
        state.attestation_count = 0;
        state.bump = ctx.bumps.state;

        emit!(ProgramInitialized {
            authority: state.authority,
        });

        Ok(())
    }

    /// Create a new attestation covering multiple wallets
    pub fn create_attestation(
        ctx: Context<CreateAttestation>,
        jurisdiction: Jurisdiction,
        attestation_type: AttestationType,
        tax_year: u16,
        audit_hash: [u8; 32],
        expires_at: i64,
        wallets: Vec<Pubkey>,
    ) -> Result<()> {
        require!(
            !wallets.is_empty() && wallets.len() <= MAX_WALLETS,
            AttestationError::InvalidWalletCount
        );

        let attestation_key = ctx.accounts.attestation.key();
        let authority_key = ctx.accounts.authority.key();
        let clock = Clock::get()?;

        let attestation = &mut ctx.accounts.attestation;
        let state = &mut ctx.accounts.state;

        attestation.bump = ctx.bumps.attestation;
        attestation.authority = authority_key;
        attestation.jurisdiction = jurisdiction;
        attestation.attestation_type = attestation_type;
        attestation.status = AttestationStatus::Active;
        attestation.tax_year = tax_year;
        attestation.audit_hash = audit_hash;
        attestation.issued_at = clock.unix_timestamp;
        attestation.expires_at = expires_at;
        attestation.revoked_at = 0;
        attestation.num_wallets = wallets.len() as u8;
        attestation.wallets = wallets.clone();

        state.attestation_count += 1;

        emit!(AttestationCreated {
            attestation: attestation_key,
            wallets,
            jurisdiction,
            attestation_type,
            tax_year,
            audit_hash,
            issued_at: attestation.issued_at,
            expires_at,
        });

        Ok(())
    }

    /// Update attestation status
    pub fn update_status(
        ctx: Context<UpdateAttestation>,
        new_status: AttestationStatus,
    ) -> Result<()> {
        let attestation_key = ctx.accounts.attestation.key();
        let attestation = &mut ctx.accounts.attestation;
        let old_status = attestation.status;

        require!(
            is_valid_status_transition(old_status, new_status),
            AttestationError::InvalidStatusTransition
        );

        attestation.status = new_status;

        if new_status == AttestationStatus::Revoked {
            let clock = Clock::get()?;
            attestation.revoked_at = clock.unix_timestamp;
        }

        emit!(StatusUpdated {
            attestation: attestation_key,
            old_status,
            new_status,
        });

        Ok(())
    }

    /// Revoke an attestation
    pub fn revoke_attestation(ctx: Context<UpdateAttestation>) -> Result<()> {
        let attestation_key = ctx.accounts.attestation.key();
        let attestation = &mut ctx.accounts.attestation;
        let clock = Clock::get()?;

        require!(
            attestation.status == AttestationStatus::Active,
            AttestationError::AttestationNotActive
        );

        attestation.status = AttestationStatus::Revoked;
        attestation.revoked_at = clock.unix_timestamp;

        emit!(AttestationRevoked {
            attestation: attestation_key,
            wallets: attestation.wallets.clone(),
            revoked_at: attestation.revoked_at,
        });

        Ok(())
    }
}

/// Max wallets per attestation (10 wallets * 32 bytes = 320 bytes)
pub const MAX_WALLETS: usize = 10;

fn is_valid_status_transition(from: AttestationStatus, to: AttestationStatus) -> bool {
    matches!(
        (from, to),
        (AttestationStatus::Pending, AttestationStatus::Active)
            | (AttestationStatus::Active, AttestationStatus::Expired)
            | (AttestationStatus::Active, AttestationStatus::Revoked)
            | (AttestationStatus::Pending, AttestationStatus::Revoked)
    )
}

// ============================================
// Accounts
// ============================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + ProgramState::INIT_SPACE,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, ProgramState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(
    jurisdiction: Jurisdiction,
    attestation_type: AttestationType,
    tax_year: u16,
    audit_hash: [u8; 32],
)]
pub struct CreateAttestation<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump = state.bump
    )]
    pub state: Account<'info, ProgramState>,

    #[account(
        init,
        payer = authority,
        space = 8 + Attestation::INIT_SPACE,
        seeds = [
            b"attestation",
            audit_hash.as_ref(),
        ],
        bump
    )]
    pub attestation: Account<'info, Attestation>,

    #[account(
        mut,
        constraint = authority.key() == state.authority @ AttestationError::Unauthorized
    )]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAttestation<'info> {
    #[account(
        seeds = [b"state"],
        bump = state.bump
    )]
    pub state: Account<'info, ProgramState>,

    #[account(
        mut,
        seeds = [
            b"attestation",
            attestation.audit_hash.as_ref(),
        ],
        bump = attestation.bump
    )]
    pub attestation: Account<'info, Attestation>,

    #[account(
        constraint = authority.key() == state.authority @ AttestationError::Unauthorized
    )]
    pub authority: Signer<'info>,
}

// ============================================
// State
// ============================================

#[account]
#[derive(InitSpace)]
pub struct ProgramState {
    pub authority: Pubkey,
    pub attestation_count: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Attestation {
    pub bump: u8,
    pub authority: Pubkey,
    pub jurisdiction: Jurisdiction,
    pub attestation_type: AttestationType,
    pub status: AttestationStatus,
    pub tax_year: u16,
    pub audit_hash: [u8; 32],
    pub issued_at: i64,
    pub expires_at: i64,
    pub revoked_at: i64,
    pub num_wallets: u8,
    #[max_len(10)]
    pub wallets: Vec<Pubkey>,
}

// ============================================
// Enums
// ============================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Jurisdiction {
    US = 0,
    EU = 1,
    BR = 2,
    UK = 3,
    JP = 4,
    AU = 5,
    CA = 6,
    CH = 7,
    SG = 8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum AttestationType {
    TaxCompliance = 0,
    AuditComplete = 1,
    ReportingComplete = 2,
    QuarterlyReview = 3,
    AnnualReview = 4,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum AttestationStatus {
    Pending = 0,
    Active = 1,
    Expired = 2,
    Revoked = 3,
}

// ============================================
// Events
// ============================================

#[event]
pub struct ProgramInitialized {
    pub authority: Pubkey,
}

#[event]
pub struct AttestationCreated {
    pub attestation: Pubkey,
    pub wallets: Vec<Pubkey>,
    pub jurisdiction: Jurisdiction,
    pub attestation_type: AttestationType,
    pub tax_year: u16,
    pub audit_hash: [u8; 32],
    pub issued_at: i64,
    pub expires_at: i64,
}

#[event]
pub struct StatusUpdated {
    pub attestation: Pubkey,
    pub old_status: AttestationStatus,
    pub new_status: AttestationStatus,
}

#[event]
pub struct AttestationRevoked {
    pub attestation: Pubkey,
    pub wallets: Vec<Pubkey>,
    pub revoked_at: i64,
}

// ============================================
// Errors
// ============================================

#[error_code]
pub enum AttestationError {
    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Invalid status transition")]
    InvalidStatusTransition,

    #[msg("Attestation is not active")]
    AttestationNotActive,

    #[msg("Attestation has expired")]
    AttestationExpired,

    #[msg("Invalid jurisdiction")]
    InvalidJurisdiction,

    #[msg("Invalid attestation type")]
    InvalidAttestationType,

    #[msg("Invalid wallet count: must be 1-10 wallets")]
    InvalidWalletCount,
}
