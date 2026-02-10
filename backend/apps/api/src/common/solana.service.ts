import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

export interface TokenBalance {
  mint: string;
  amount: number;
}

@Injectable()
export class SolanaService {
  private readonly logger = new Logger(SolanaService.name);
  private readonly connection: Connection;

  constructor(private configService: ConfigService) {
    const rpcUrl = this.configService.get<string>('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com');
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Fetch all token balances for a wallet address.
   * Returns SOL + all SPL tokens with non-zero balance.
   */
  async getBalances(address: string): Promise<TokenBalance[]> {
    const pubkey = new PublicKey(address);
    const balances: TokenBalance[] = [];

    try {
      // SOL balance
      const solBalance = await this.connection.getBalance(pubkey);
      if (solBalance > 0) {
        balances.push({ mint: SOL_MINT, amount: solBalance / LAMPORTS_PER_SOL });
      }

      // SPL token balances
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(pubkey, {
        programId: TOKEN_PROGRAM_ID,
      });

      for (const { account } of tokenAccounts.value) {
        const parsed = account.data.parsed?.info;
        if (!parsed) continue;
        const amount = parsed.tokenAmount?.uiAmount;
        const mint = parsed.mint;
        if (mint && amount && amount > 0) {
          balances.push({ mint, amount });
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to fetch balances for ${address}: ${error}`);
    }

    return balances;
  }

  /**
   * Fetch balances across multiple wallet addresses and aggregate by mint.
   */
  async getAggregatedBalances(addresses: string[]): Promise<Map<string, number>> {
    const aggregated = new Map<string, number>();

    const results = await Promise.all(
      addresses.map(addr => this.getBalances(addr)),
    );

    for (const balances of results) {
      for (const { mint, amount } of balances) {
        aggregated.set(mint, (aggregated.get(mint) ?? 0) + amount);
      }
    }

    return aggregated;
  }
}
