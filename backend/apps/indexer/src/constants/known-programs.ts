export interface KnownProgram {
  name: string;
  entityType: string;
  txType?: string;
}

export const KNOWN_PROGRAMS: Map<string, KnownProgram> = new Map([
  // System Programs
  ['11111111111111111111111111111111', { name: 'System Program', entityType: 'SYSTEM' }],
  ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', { name: 'Token Program', entityType: 'SYSTEM' }],
  ['TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', { name: 'Token 2022', entityType: 'SYSTEM' }],
  ['ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', { name: 'Associated Token', entityType: 'SYSTEM' }],

  // Staking - Native
  ['Stake11111111111111111111111111111111111111', { name: 'Stake Program', entityType: 'STAKING', txType: 'STAKE' }],

  // Staking - Liquid (Marinade)
  ['MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD', { name: 'Marinade Finance', entityType: 'STAKING', txType: 'STAKE' }],
  ['mRefx8ypXNxE59NhoBqwqb3vTvjgf8MYECp4kgJWiDY', { name: 'Marinade Referral', entityType: 'STAKING', txType: 'STAKE' }],

  // Staking - Liquid (Jito)
  ['Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb', { name: 'Jito Staking', entityType: 'STAKING', txType: 'STAKE' }],

  // Staking - Liquid (BlazeStake)
  ['BLZEsAXzxGETEMfWcBqBR4YjbFPSTVEbrKGJw6F7v7nD', { name: 'BlazeStake', entityType: 'STAKING', txType: 'STAKE' }],

  // DEX - Jupiter
  ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', { name: 'Jupiter v6', entityType: 'DEX', txType: 'SWAP' }],
  ['JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', { name: 'Jupiter v4', entityType: 'DEX', txType: 'SWAP' }],

  // DEX - Raydium
  ['675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', { name: 'Raydium AMM', entityType: 'DEX', txType: 'SWAP' }],
  ['CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', { name: 'Raydium CLMM', entityType: 'DEX', txType: 'SWAP' }],

  // DEX - Orca
  ['whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', { name: 'Orca Whirlpool', entityType: 'DEX', txType: 'SWAP' }],
  ['9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', { name: 'Orca v1', entityType: 'DEX', txType: 'SWAP' }],

  // Lending - Solend
  ['So1endDq2YkqhipRh3WViPa8hFULewJHGDMFineLspsg', { name: 'Solend', entityType: 'LENDING' }],

  // Lending - Marginfi
  ['MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA', { name: 'Marginfi', entityType: 'LENDING' }],

  // Lending - Kamino
  ['KLend2g3cP87ber8FQxTo4STYnGBhvM9LPbXPjXmTdgq', { name: 'Kamino Lending', entityType: 'LENDING' }],

  // Bridge - Wormhole
  ['worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth', { name: 'Wormhole', entityType: 'BRIDGE' }],

  // Bridge - deBridge
  ['DEbrdGj3HsRsAzx6uH4MKyREKxVAfBydijLUF3ygsFfh', { name: 'deBridge', entityType: 'BRIDGE' }],

  // LP - Meteora
  ['LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', { name: 'Meteora DLMM', entityType: 'LP' }],

  // Program Deployment / Upgrade
  ['BPFLoaderUpgradeab1e11111111111111111111111', { name: 'BPF Loader Upgradeable', entityType: 'INFRA', txType: 'PROGRAM_INTERACTION' }],
  ['BPFLoader2111111111111111111111111111111111', { name: 'BPF Loader v2', entityType: 'INFRA', txType: 'PROGRAM_INTERACTION' }],

  // Infrastructure
  ['AddressLookupTab1e1111111111111111111111111', { name: 'Address Lookup Table', entityType: 'INFRA', txType: 'PROGRAM_INTERACTION' }],
  ['ComputeBudget111111111111111111111111111111', { name: 'Compute Budget', entityType: 'INFRA' }],
]);

export function getKnownProgram(programId: string): KnownProgram | undefined {
  return KNOWN_PROGRAMS.get(programId);
}
