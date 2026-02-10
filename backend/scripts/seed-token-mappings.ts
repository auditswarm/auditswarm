/**
 * Seed token symbol mappings for exchange symbol → mint resolution.
 *
 * Usage: NODE_PATH=libs/database/node_modules npx tsx scripts/seed-token-mappings.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface TokenMapping {
  symbol: string;
  network: string;
  mint: string;
  decimals: number;
  isDefault: boolean;
}

const MAPPINGS: TokenMapping[] = [
  // Solana native & major SPL tokens
  { symbol: 'SOL',   network: 'solana', mint: 'So11111111111111111111111111111111111111112',  decimals: 9,  isDefault: true },
  { symbol: 'USDC',  network: 'solana', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6,  isDefault: true },
  { symbol: 'USDT',  network: 'solana', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6,  isDefault: true },
  { symbol: 'BONK',  network: 'solana', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5,  isDefault: true },
  { symbol: 'JTO',   network: 'solana', mint: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',  decimals: 9,  isDefault: true },
  { symbol: 'JUP',   network: 'solana', mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  decimals: 6,  isDefault: true },
  { symbol: 'RAY',   network: 'solana', mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', decimals: 6,  isDefault: true },
  { symbol: 'PYTH',  network: 'solana', mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', decimals: 6,  isDefault: true },
  { symbol: 'WIF',   network: 'solana', mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', decimals: 6,  isDefault: true },
  { symbol: 'RNDR',  network: 'solana', mint: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',  decimals: 8,  isDefault: true },
  { symbol: 'W',     network: 'solana', mint: '85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ', decimals: 6,  isDefault: true },
  { symbol: 'ORCA',  network: 'solana', mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',  decimals: 6,  isDefault: true },
  { symbol: 'MNDE',  network: 'solana', mint: 'MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey',  decimals: 9,  isDefault: true },
  { symbol: 'MSOL',  network: 'solana', mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  decimals: 9,  isDefault: true },
  { symbol: 'JITOSOL', network: 'solana', mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', decimals: 9, isDefault: true },
  { symbol: 'BSOL',  network: 'solana', mint: 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',  decimals: 9,  isDefault: true },

  // Wrapped tokens on Solana (from Binance deposits)
  { symbol: 'BTC',  network: 'solana', mint: '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E', decimals: 6,  isDefault: false },
  { symbol: 'ETH',  network: 'solana', mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', decimals: 8,  isDefault: false },

  // Ethereum native tokens
  { symbol: 'ETH',  network: 'ethereum', mint: 'native', decimals: 18, isDefault: true },
  { symbol: 'USDC', network: 'ethereum', mint: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, isDefault: false },
  { symbol: 'USDT', network: 'ethereum', mint: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, isDefault: false },
  { symbol: 'WETH', network: 'ethereum', mint: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18, isDefault: true },
  { symbol: 'WBTC', network: 'ethereum', mint: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8, isDefault: true },
  { symbol: 'DAI',  network: 'ethereum', mint: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18, isDefault: true },
  { symbol: 'LINK', network: 'ethereum', mint: '0x514910771AF9Ca656af840dff83E8264EcF986CA', decimals: 18, isDefault: true },

  // BSC native tokens
  { symbol: 'BNB',  network: 'bsc',  mint: 'native', decimals: 18, isDefault: true },
  { symbol: 'BUSD', network: 'bsc',  mint: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', decimals: 18, isDefault: true },
  { symbol: 'CAKE', network: 'bsc',  mint: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', decimals: 18, isDefault: true },

  // Bitcoin
  { symbol: 'BTC',  network: 'bitcoin', mint: 'native', decimals: 8, isDefault: true },

  // Binance internal (for exchange-only tokens with no chain equivalent)
  { symbol: 'BNB',  network: 'binance-internal', mint: 'binance:BNB',  decimals: 8, isDefault: false },
  { symbol: 'LDBNB', network: 'binance-internal', mint: 'binance:LDBNB', decimals: 8, isDefault: true },
  { symbol: 'BETH', network: 'binance-internal', mint: 'binance:BETH', decimals: 18, isDefault: true },
  { symbol: 'BNSOL', network: 'binance-internal', mint: 'binance:BNSOL', decimals: 9, isDefault: true },

  // Polygon
  { symbol: 'MATIC', network: 'polygon', mint: 'native', decimals: 18, isDefault: true },
  { symbol: 'POL',   network: 'polygon', mint: 'native', decimals: 18, isDefault: false },

  // Avalanche
  { symbol: 'AVAX', network: 'avalanche', mint: 'native', decimals: 18, isDefault: true },

  // Arbitrum
  { symbol: 'ARB', network: 'arbitrum', mint: '0x912CE59144191C1204E64559FE8253a0e49E6548', decimals: 18, isDefault: true },

  // Major tokens (default network = exchange pseudo-mint)
  { symbol: 'ADA',  network: 'cardano', mint: 'native', decimals: 6,  isDefault: true },
  { symbol: 'DOT',  network: 'polkadot', mint: 'native', decimals: 10, isDefault: true },
  { symbol: 'XRP',  network: 'xrp',     mint: 'native', decimals: 6,  isDefault: true },
  { symbol: 'DOGE', network: 'dogecoin', mint: 'native', decimals: 8,  isDefault: true },
  { symbol: 'SHIB', network: 'ethereum', mint: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', decimals: 18, isDefault: true },
  { symbol: 'LTC',  network: 'litecoin', mint: 'native', decimals: 8,  isDefault: true },
  { symbol: 'ATOM', network: 'cosmos',   mint: 'native', decimals: 6,  isDefault: true },
  { symbol: 'NEAR', network: 'near',     mint: 'native', decimals: 24, isDefault: true },
  { symbol: 'FTM',  network: 'fantom',   mint: 'native', decimals: 18, isDefault: true },
  { symbol: 'APT',  network: 'aptos',    mint: 'native', decimals: 8,  isDefault: true },
  { symbol: 'SUI',  network: 'sui',      mint: 'native', decimals: 9,  isDefault: true },
  { symbol: 'OP',   network: 'optimism', mint: '0x4200000000000000000000000000000000000042', decimals: 18, isDefault: true },
  { symbol: 'TRX',  network: 'tron',     mint: 'native', decimals: 6,  isDefault: true },

  // Stablecoins on multiple chains
  { symbol: 'FDUSD', network: 'bsc',      mint: '0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409', decimals: 18, isDefault: true },
  { symbol: 'TUSD',  network: 'ethereum', mint: '0x0000000000085d4780B73119b644AE5ecd22b376', decimals: 18, isDefault: true },
];

async function main() {
  console.log(`Seeding ${MAPPINGS.length} token symbol mappings...`);

  let created = 0;
  let updated = 0;

  for (const m of MAPPINGS) {
    const result = await prisma.tokenSymbolMapping.upsert({
      where: {
        symbol_network: { symbol: m.symbol, network: m.network },
      },
      create: {
        symbol: m.symbol,
        network: m.network,
        mint: m.mint,
        decimals: m.decimals,
        source: 'SEED',
        isDefault: m.isDefault,
      },
      update: {
        mint: m.mint,
        decimals: m.decimals,
        isDefault: m.isDefault,
      },
    });

    if (result.source === 'SEED') {
      created++;
    } else {
      updated++;
    }
  }

  const total = await prisma.tokenSymbolMapping.count();
  console.log(`Done. Created/updated: ${created + updated}. Total mappings in DB: ${total}`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
