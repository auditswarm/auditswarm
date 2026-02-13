import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const PROGRAM_ID = new PublicKey('52LCg2VXDYgam4yHkXEp2vN2psUmo6Q7rv5efRm7ic8c');
const INITIALIZE_DISCRIMINATOR = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);

async function main() {
  // Connect to devnet
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  console.log(`Connected to: ${rpcUrl}`);

  // Load authority keypair
  const keypairPath = process.env.SOLANA_KEYPAIR || path.join(
    process.env.HOME || '~',
    '.config/solana/id.json',
  );
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  console.log(`Authority: ${authority.publicKey.toBase58()}`);

  // Check balance
  const balance = await connection.getBalance(authority.publicKey);
  console.log(`Balance: ${balance / 1e9} SOL`);

  // Derive ProgramState PDA with seeds ["state"]
  const [statePda, stateBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('state')],
    PROGRAM_ID,
  );
  console.log(`State PDA: ${statePda.toBase58()} (bump: ${stateBump})`);

  // Check if already initialized
  const stateAccount = await connection.getAccountInfo(statePda);
  if (stateAccount) {
    console.log('Program state already initialized!');
    console.log(`  Owner: ${stateAccount.owner.toBase58()}`);
    console.log(`  Data length: ${stateAccount.data.length} bytes`);
    return;
  }

  // Build initialize instruction
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: statePda, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: INITIALIZE_DISCRIMINATOR,
  });

  // Build and send transaction
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const messageV0 = new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([authority]);

  console.log('Sending initialize transaction...');
  const signature = await connection.sendTransaction(tx);
  console.log(`Signature: ${signature}`);

  // Confirm
  const confirmation = await connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight,
  });

  if (confirmation.value.err) {
    console.error('Transaction failed:', confirmation.value.err);
    process.exit(1);
  }

  console.log('Program state initialized successfully!');
  console.log(`Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);

  // Verify
  const verifyAccount = await connection.getAccountInfo(statePda);
  if (verifyAccount) {
    console.log(`Verified: State account exists (${verifyAccount.data.length} bytes)`);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
