import { registerAs } from '@nestjs/config';

export default registerAs('helius', () => ({
  apiKey: process.env.HELIUS_API_KEY || '',
  rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  rateLimit: parseInt(process.env.HELIUS_RATE_LIMIT || '50', 10),
}));
