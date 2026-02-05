use anchor_lang::prelude::*;

declare_id!("Attest1111111111111111111111111111111111111");

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

    /// Create a new attestation
    pub fn create_attestation(
        ctx: Context<CreateAttestation>,
        jurisdiction: Jurisdiction,
        attestation_type: AttestationType,
        tax_year: u16,
        audit_hash: [u8; 32],
        expires_at: i64,
    ) -> Result<()> {
        let attestation = &mut ctx.accounts.attestation;
        let state = &mut ctx.accounts.state;
        let clock = Clock::get()?;

        attestation.bump = ctx.bumps.attestation;
        attestation.authority = ctx.accounts.authority.key();
        attestation.wallet = ctx.accounts.wallet.key();
        attestation.jurisdiction = jurisdiction;
        attestation.attestation_type = attestation_type;
        attestation.status = AttestationStatus::Active;
        attestation.tax_year = tax_year;
        attestation.audit_hash = audit_hash;
        attestation.issued_at = clock.unix_timestamp;
        attestation.expires_at = expires_at;
        attestation.revoked_at = 0;

        state.attestation_count += 1;

        emit!(AttestationCreated {
            attestation: ctx.accounts.attestation.key(),
            wallet: attestation.wallet,
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
        let attestation = &mut ctx.accounts.attestation;
        let old_status = attestation.status;

        // Validate status transition
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
            attestation: ctx.accounts.attestation.key(),
            old_status,
            new_status,
        });

        Ok(())
    }

    /// Revoke an attestation
    pub fn revoke_attestation(ctx: Context<UpdateAttestation>) -> Result<()> {
        let attestation = &mut ctx.accounts.attestation;
        let clock = Clock::get()?;

        require!(
            attestation.status == AttestationStatus::Active,
            AttestationError::AttestationNotActive
        );

        attestation.status = AttestationStatus::Revoked;
        attestation.revoked_at = clock.unix_timestamp;

        emit!(AttestationRevoked {
            attestation: ctx.accounts.attestation.key(),
            wallet: attestation.wallet,
            revoked_at: attestation.revoked_at,
        });

        Ok(())
    }
}

fn is_valid_status_transition(from: AttestationStatus, to: AttestationStatus) -> bool {
    match (from, to) {
        (AttestationStatus::Pending, AttestationStatus::Active) => true,
        (AttestationStatus::Active, AttestationStatus::Expired) => true,
        (AttestationStatus::Active, AttestationStatus::Revoked) => true,
        (AttestationStatus::Pending, AttestationStatus::Revoked) => true,
        _ => false,
    }
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
#[instruction(jurisdiction: Jurisdiction, attestation_type: AttestationType, tax_year: u16)]
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
            wallet.key().as_ref(),
            &[jurisdiction as u8],
            &[attestation_type as u8],
            &tax_year.to_le_bytes()
        ],
        bump
    )]
    pub attestation: Account<'info, Attestation>,

    /// CHECK: The wallet being attested
    pub wallet: UncheckedAccount<'info>,

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
            attestation.wallet.as_ref(),
            &[attestation.jurisdiction as u8],
            &[attestation.attestation_type as u8],
            &attestation.tax_year.to_le_bytes()
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
    pub wallet: Pubkey,
    pub jurisdiction: Jurisdiction,
    pub attestation_type: AttestationType,
    pub status: AttestationStatus,
    pub tax_year: u16,
    pub audit_hash: [u8; 32],
    pub issued_at: i64,
    pub expires_at: i64,
    pub revoked_at: i64,
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
    pub wallet: Pubkey,
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
    pub wallet: Pubkey,
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
}
