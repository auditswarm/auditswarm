import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Find all BNB-related flows
  const bnbFlows = await prisma.transactionFlow.findMany({
    where: {
      OR: [
        { mint: { contains: 'bnb' } },
        { mint: { contains: 'BNB' } },
        { symbol: { contains: 'BNB' } },
      ]
    },
    include: { transaction: { select: { type: true, timestamp: true, source: true, exchangeName: true } } },
    orderBy: { createdAt: 'asc' },
  });

  console.log('=== ALL BNB FLOWS ===');
  console.log('Count:', bnbFlows.length);
  for (const f of bnbFlows) {
    console.log(
      f.direction.padEnd(4),
      f.mint.padEnd(20),
      (f.symbol || '-').padEnd(6),
      'amt:', Number(f.amount).toFixed(4).padStart(12),
      'usd:', (f.valueUsd ? Number(f.valueUsd).toFixed(2) : 'NULL').padStart(10),
      'price:', (f.priceAtExecution ? Number(f.priceAtExecution).toFixed(2) : 'NULL').padStart(10),
      '|', f.transaction.type.padEnd(22),
      f.transaction.timestamp.toISOString().slice(0, 10),
      f.isFee ? 'FEE' : '',
    );
  }

  // Check which types BNB IN/OUT flows have
  const bnbIn = bnbFlows.filter(f => f.direction === 'IN' && f.isFee === false);
  const bnbOut = bnbFlows.filter(f => f.direction === 'OUT' && f.isFee === false);
  console.log('\nBNB IN (non-fee):', bnbIn.length, '— types:', [...new Set(bnbIn.map(f => f.transaction.type))]);
  console.log('BNB OUT (non-fee):', bnbOut.length, '— types:', [...new Set(bnbOut.map(f => f.transaction.type))]);

  // Check the acquisition types that build cost basis lots
  const acquisitionTypes = [
    'BUY', 'TRANSFER_IN', 'SWAP', 'REWARD', 'AIRDROP',
    'EXCHANGE_TRADE', 'EXCHANGE_C2C_TRADE', 'EXCHANGE_FIAT_BUY',
    'EXCHANGE_CONVERT', 'EXCHANGE_DUST_CONVERT',
    'EXCHANGE_INTEREST', 'EXCHANGE_DIVIDEND',
    'EXCHANGE_UNSTAKE', 'MARGIN_BORROW',
  ];

  const bnbAcquisitions = bnbIn.filter(f => acquisitionTypes.includes(f.transaction.type));
  console.log('\nBNB acquisitions (IN + acquisition type):', bnbAcquisitions.length);
  for (const f of bnbAcquisitions) {
    console.log('  ', f.transaction.type, Number(f.amount).toFixed(4), 'valueUsd:', f.valueUsd ? Number(f.valueUsd).toFixed(2) : 'NULL');
  }

  // Now check: does the bee actually see these? Check if exchange txs with BNB are loaded
  const bnbTxs = await prisma.transaction.findMany({
    where: {
      flows: { some: { OR: [{ mint: { contains: 'bnb' } }, { mint: { contains: 'BNB' } }, { symbol: { contains: 'BNB' } }] } },
    },
    select: { id: true, type: true, timestamp: true, source: true, walletId: true, exchangeConnectionId: true },
    orderBy: { timestamp: 'asc' },
  });

  console.log('\n=== BNB TRANSACTIONS ===');
  console.log('Count:', bnbTxs.length);
  for (const tx of bnbTxs) {
    console.log(
      tx.type.padEnd(22),
      tx.timestamp.toISOString().slice(0, 10),
      'source:', (tx.source || 'ONCHAIN').padEnd(10),
      'walletId:', tx.walletId ? tx.walletId.slice(0, 8) : 'NULL',
      'exchangeId:', tx.exchangeConnectionId ? tx.exchangeConnectionId.slice(0, 8) : 'NULL',
    );
  }

  // Now check: what does audit.processor.ts loadTransactions() actually load?
  // It uses findByFilter with walletIds AND exchangeConnectionIds
  // Let's check if exchangeConnectionIds are being passed
  const exchangeConns = await prisma.exchangeConnection.findMany({
    select: { id: true, exchangeName: true, status: true },
  });
  console.log('\n=== EXCHANGE CONNECTIONS ===');
  for (const ec of exchangeConns) {
    console.log('  ', ec.id.slice(0, 12), ec.exchangeName, ec.status);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
