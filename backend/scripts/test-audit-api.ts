/**
 * Test audit through the full API pipeline.
 * Directly creates an audit job and monitors it via DB, bypassing auth.
 *
 * Usage: NODE_PATH=libs/database/node_modules:node_modules npx tsx scripts/test-audit-api.ts
 */

import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst();
  if (!user) { console.log('No user found'); return; }
  console.log('User:', user.id);

  const wallets = await prisma.wallet.findMany({
    where: { userId: user.id },
    select: { id: true, address: true },
  });
  console.log('Wallets:', wallets.length);

  const exchangeConnections = await prisma.exchangeConnection.findMany({
    where: { userId: user.id, status: { not: 'REVOKED' } },
    select: { id: true, exchangeName: true },
  });
  console.log('Exchange connections:', exchangeConnections.length);

  const walletIds = wallets.map(w => w.id);
  const exchangeConnectionIds = exchangeConnections.map(c => c.id);

  // Set jurisdiction via CLI arg or default to BR
  const jurisdiction = process.argv[2]?.toUpperCase() || 'BR';
  console.log('Jurisdiction:', jurisdiction);

  // Create audit record directly in DB
  const audit = await prisma.audit.create({
    data: {
      userId: user.id,
      jurisdiction,
      type: 'ANNUAL',
      taxYear: 2025,
      status: 'QUEUED',
      progress: 0,
      options: {
        costBasisMethod: 'FIFO',
        includeStaking: true,
        includeAirdrops: true,
        includeNFTs: false,
        includeDeFi: true,
        includeFees: true,
        currency: 'USD',
      },
    },
  });
  console.log('\nAudit created:', audit.id);

  // Dispatch job directly to BullMQ
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

  const queue = new Queue('audit', {
    connection: { host: redisHost, port: redisPort },
  });

  const jobData = {
    auditId: audit.id,
    userId: user.id,
    walletIds,
    exchangeConnectionIds,
    jurisdiction,
    taxYear: 2025,
    options: {
      costBasisMethod: 'FIFO',
      includeStaking: true,
      includeAirdrops: true,
      includeNFTs: false,
      includeDeFi: true,
      includeFees: true,
      currency: 'USD',
    },
  };

  await queue.add('PROCESS_AUDIT', jobData, {
    jobId: `audit-${audit.id}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
  console.log('Job dispatched to audit queue');

  // Poll DB for completion
  console.log('\nPolling for completion...');
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 2000));

    const current = await prisma.audit.findUnique({ where: { id: audit.id } });
    if (!current) { console.log('Audit record disappeared!'); break; }

    console.log(`  [${i}] status: ${current.status} | progress: ${current.progress} | ${current.statusMessage || ''}`);

    if (current.status === 'COMPLETED') {
      if (current.resultId) {
        const result = await prisma.auditResult.findUnique({ where: { id: current.resultId } });
        if (result) {
          console.log('\n========================================');
          console.log('AUDIT RESULT');
          console.log('========================================');
          console.log(`  Net gain/loss: $${Number(result.netGainLoss || 0).toFixed(2)}`);
          console.log(`  Total income: $${Number(result.totalIncome || 0).toFixed(2)}`);
          console.log(`  Estimated tax: $${Number(result.estimatedTax || 0).toFixed(2)}`);
          console.log(`  Total transactions: ${result.totalTransactions}`);
          console.log(`  Total wallets: ${result.totalWallets}`);

          const cg = result.capitalGains as any;
          if (cg) {
            console.log('\nCapital Gains:');
            console.log(`  Short-term gains: $${cg.shortTermGains}`);
            console.log(`  Short-term losses: $${cg.shortTermLosses}`);
            console.log(`  Long-term gains: $${cg.longTermGains}`);
            console.log(`  Long-term losses: $${cg.longTermLosses}`);
            console.log(`  Net total: $${cg.totalNet}`);
            console.log(`  Gain transactions: ${cg.transactions?.length || 0}`);
          }

          const inc = result.income as any;
          if (inc) {
            console.log('\nIncome:');
            console.log(`  Staking: $${inc.staking}`);
            console.log(`  Airdrops: $${inc.airdrops}`);
            console.log(`  Total: $${inc.total}`);
            console.log(`  Events: ${inc.events?.length || 0}`);
          }

          const holdings = result.holdings as any;
          if (holdings) {
            console.log('\nHoldings:', holdings.assets?.length || 0, 'assets');
            for (const a of (holdings.assets || []).slice(0, 10)) {
              console.log(`  ${(a.symbol || a.mint?.slice(0, 8)).padEnd(12)} | balance: ${a.balance} | costBasis: $${a.costBasis}`);
            }
          }

          // Monthly Breakdown (BR exemption)
          const meta = result.metadata as any;
          const mb = meta?.monthlyBreakdown;
          if (mb) {
            console.log('\nMonthly Breakdown (BR R$35K Exemption):');
            console.log(`  Currency: ${mb.currency}`);
            console.log(`  Exempt months: ${mb.exemptMonths} | Taxable months: ${mb.taxableMonths}`);
            console.log(`  Total exempt gains: ${mb.totalExemptGains} | Total taxable gains: ${mb.totalTaxableGains}`);
            console.log('');
            console.log('  Month     | Sales Volume   | Capital Gains  | Exempt | Taxable Gains');
            console.log('  ' + '-'.repeat(75));
            for (const e of mb.entries || []) {
              if (e.salesVolume > 0 || e.capitalGains !== 0) {
                console.log(`  ${e.label.padEnd(10)}| R$${String(e.salesVolume.toFixed(2)).padStart(12)} | R$${String(e.capitalGains.toFixed(2)).padStart(12)} | ${e.exempt ? 'YES' : 'NO '} | R$${String(e.taxableGains.toFixed(2)).padStart(12)}`);
              }
            }
          }

          // Schedule D (US)
          const sd = meta?.scheduleDSummary;
          if (sd) {
            console.log('\nSchedule D Summary:');
            console.log(`  Short-term: Proceeds: $${sd.shortTermProceeds} | Cost: $${sd.shortTermCostBasis} | Gain/Loss: $${sd.shortTermGainLoss}`);
            console.log(`  Long-term:  Proceeds: $${sd.longTermProceeds} | Cost: $${sd.longTermCostBasis} | Gain/Loss: $${sd.longTermGainLoss}`);
            console.log(`  Net: $${sd.totalNetGainLoss}`);
            if (sd.capitalLossDeduction < 0) {
              console.log(`  Capital loss deduction: $${sd.capitalLossDeduction} (max -$3,000/yr)`);
              console.log(`  Carryforward: $${sd.capitalLossCarryforward}`);
            }
            if (sd.niitAmount > 0) {
              console.log(`  NIIT (3.8%): $${sd.niitAmount}`);
            }
          }

          // FBAR (US)
          const fbar = meta?.fbarReport;
          if (fbar) {
            console.log('\nFBAR Report:');
            console.log(`  FBAR required: ${fbar.fbarRequired ? 'YES' : 'NO'} (threshold: $${fbar.fbarThreshold})`);
            console.log(`  FATCA required: ${fbar.fatcaRequired ? 'YES' : 'NO'} (threshold: $${fbar.fatcaThreshold})`);
            console.log(`  Aggregate foreign peak: $${fbar.aggregatePeakValue}`);
            for (const acc of fbar.accounts || []) {
              console.log(`    ${acc.exchangeName} (${acc.exchangeCountry}) — Peak: $${acc.peakBalance} | Foreign: ${acc.isForeignExchange}`);
            }
          }

          // Form 8949 boxes (US)
          const cgTxs = cg?.transactions || [];
          if (cgTxs.length > 0 && cgTxs[0]?.form8949Box) {
            const boxCounts: Record<string, number> = {};
            for (const t of cgTxs) {
              const box = t.form8949Box || '?';
              boxCounts[box] = (boxCounts[box] || 0) + 1;
            }
            console.log('\nForm 8949 Box Distribution:');
            for (const [box, count] of Object.entries(boxCounts)) {
              console.log(`  Box ${box}: ${count} transactions`);
            }
          }

          const allZero = Number(result.netGainLoss || 0) === 0
            && Number(result.totalIncome || 0) === 0
            && Number(result.estimatedTax || 0) === 0;

          if (allZero) {
            console.log('\n  ⚠️  ALL ZEROS — Something is still wrong!');
          } else {
            console.log('\n  ✅  Non-zero results — Full pipeline working!');
          }
        }
      } else {
        console.log('Completed but no resultId');
      }
      break;
    }

    if (current.status === 'FAILED' || current.status === 'ERROR') {
      console.log('\nAudit FAILED');
      console.log('Error:', current.error);
      break;
    }
  }

  await queue.close();
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
