import * as fs from 'fs';
import * as path from 'path';

// Load .env manually
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

import { PrismaClient } from '@prisma/client';
import { RestClientV5 } from 'bybit-api';
import * as crypto from 'crypto';

function decrypt(encryptedHex: string, encryptionKey: string): string {
  const key = Buffer.from(encryptionKey, 'hex');
  const IV_LENGTH = 16;
  const TAG_LENGTH = 16;
  const iv = Buffer.from(encryptedHex.slice(0, IV_LENGTH * 2), 'hex');
  const authTag = Buffer.from(encryptedHex.slice(IV_LENGTH * 2, (IV_LENGTH + TAG_LENGTH) * 2), 'hex');
  const ciphertext = encryptedHex.slice((IV_LENGTH + TAG_LENGTH) * 2);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function main() {
  const p = new PrismaClient();
  const conn = await p.exchangeConnection.findFirst({ where: { exchangeName: 'bybit' } });
  if (!conn) {
    console.log('No bybit connection');
    return;
  }

  const key = process.env.EXCHANGE_ENCRYPTION_KEY;
  console.log('EXCHANGE_ENCRYPTION_KEY set:', !!key, 'length:', key?.length);
  console.log('DATABASE_URL set:', !!process.env.DATABASE_URL);
  if (!key) {
    console.log('Missing EXCHANGE_ENCRYPTION_KEY');
    return;
  }
  const apiKey = decrypt(conn.encryptedApiKey, key);
  const apiSecret = decrypt(conn.encryptedApiSecret, key);

  const client = new RestClientV5({ key: apiKey, secret: apiSecret, recv_window: 10000 });

  // 1. Test connection
  const apiInfo = await client.getQueryApiKey();
  console.log('API Key Info retCode:', apiInfo.retCode, 'retMsg:', apiInfo.retMsg);
  console.log('UserID:', apiInfo.result?.userID, 'Permissions:', JSON.stringify(apiInfo.result?.permissions));

  const now = Date.now();

  // 2. Deposits - no filter
  console.log('\n--- DEPOSITS (no filter) ---');
  const deps = await client.getDepositRecords({});
  console.log('retCode:', deps.retCode, 'retMsg:', deps.retMsg);
  console.log('Rows count:', deps.result?.rows?.length);
  if (deps.result?.rows?.length > 0) {
    console.log('Sample:', JSON.stringify(deps.result.rows[0], null, 2));
  }

  // 3. Deposits with 30d range
  console.log('\n--- DEPOSITS (last 30 days) ---');
  const deps2 = await client.getDepositRecords({
    startTime: now - 30 * 24 * 60 * 60 * 1000,
    endTime: now,
    limit: 50,
  });
  console.log('retCode:', deps2.retCode, 'retMsg:', deps2.retMsg);
  console.log('Rows count:', deps2.result?.rows?.length);

  // 4. Withdrawals - no filter
  console.log('\n--- WITHDRAWALS (no filter) ---');
  const withs = await client.getWithdrawalRecords({});
  console.log('retCode:', withs.retCode, 'retMsg:', withs.retMsg);
  const withRows = (withs.result as any)?.rows ?? [];
  console.log('Rows count:', withRows.length);
  if (withRows.length > 0) {
    console.log('Sample:', JSON.stringify(withRows[0], null, 2));
  }

  // 5. Spot trades - last 7 days
  console.log('\n--- SPOT TRADES (last 7 days) ---');
  const trades = await client.getExecutionList({
    category: 'spot',
    startTime: now - 7 * 24 * 60 * 60 * 1000,
    endTime: now,
    limit: 100,
  });
  console.log('retCode:', trades.retCode, 'retMsg:', trades.retMsg);
  console.log('List count:', trades.result?.list?.length);
  if (trades.result?.list?.length > 0) {
    console.log('Sample:', JSON.stringify(trades.result.list[0], null, 2));
  }

  // 6. Spot trades - wider
  console.log('\n--- SPOT TRADES (last 180 days, no time filter) ---');
  const trades2 = await client.getExecutionList({
    category: 'spot',
    limit: 100,
  });
  console.log('retCode:', trades2.retCode, 'retMsg:', trades2.retMsg);
  console.log('List count:', trades2.result?.list?.length);
  if (trades2.result?.list?.length > 0) {
    console.log('First:', trades2.result.list[0].symbol, trades2.result.list[0].side, trades2.result.list[0].execTime);
    console.log('Last:', trades2.result.list[trades2.result.list.length - 1].symbol, trades2.result.list[trades2.result.list.length - 1].side, trades2.result.list[trades2.result.list.length - 1].execTime);
  }

  // 7. Wallet balance UNIFIED
  console.log('\n--- WALLET BALANCE (UNIFIED) ---');
  const bal = await client.getWalletBalance({ accountType: 'UNIFIED' });
  console.log('retCode:', bal.retCode, 'retMsg:', bal.retMsg);
  if (bal.result?.list?.length > 0) {
    const coins = (bal.result.list[0] as any).coin || [];
    console.log('Coins with balance:');
    coins.forEach((c: any) => {
      const wb = parseFloat(c.walletBalance || '0');
      if (wb > 0) console.log('  ', c.coin, 'walletBalance:', c.walletBalance, 'available:', c.availableToWithdraw);
    });
  }

  // 8. FUND balance
  console.log('\n--- FUND BALANCE ---');
  const fundBal = await client.getAllCoinsBalance({ accountType: 'FUND' });
  console.log('retCode:', fundBal.retCode, 'retMsg:', fundBal.retMsg);
  const fundCoins = (fundBal.result as any)?.balance || [];
  fundCoins.forEach((c: any) => {
    const wb = parseFloat(c.walletBalance || '0');
    if (wb > 0) console.log('  ', c.coin, 'balance:', c.walletBalance);
  });

  // 9. Convert history
  console.log('\n--- CONVERT HISTORY ---');
  const converts = await client.getConvertHistory({});
  console.log('retCode:', converts.retCode, 'retMsg:', converts.retMsg);
  console.log('List count:', converts.result?.list?.length);

  // 10. Transaction log
  console.log('\n--- TRANSACTION LOG ---');
  const txLog = await client.getTransactionLog({ limit: 10 });
  console.log('retCode:', txLog.retCode, 'retMsg:', txLog.retMsg);
  const logList = (txLog.result as any)?.list || [];
  console.log('List count:', logList.length);
  if (logList.length > 0) {
    console.log('Types found:', [...new Set(logList.map((l: any) => l.type))].join(', '));
    console.log('Sample:', JSON.stringify(logList[0], null, 2));
  }

  // 11. P2P Orders
  console.log('\n--- P2P ORDERS ---');
  try {
    const p2p = await client.getP2POrders({} as any);
    console.log('retCode:', p2p.retCode, 'retMsg:', p2p.retMsg);
    console.log('Result:', JSON.stringify(p2p.result).substring(0, 300));
  } catch (e: any) {
    console.log('P2P error:', e.message);
  }

  // 12. Earn order history
  console.log('\n--- EARN ORDER HISTORY ---');
  try {
    const earn = await client.getEarnOrderHistory({ category: 'FlexibleSaving' } as any);
    console.log('retCode:', earn.retCode, 'retMsg:', earn.retMsg);
    console.log('List count:', earn.result?.list?.length);
  } catch (e: any) {
    console.log('Earn error:', e.message);
  }

  // 13. Earn positions
  console.log('\n--- EARN POSITIONS ---');
  try {
    const earnPos = await client.getEarnPosition({} as any);
    console.log('retCode:', earnPos.retCode, 'retMsg:', earnPos.retMsg);
    console.log('List count:', earnPos.result?.list?.length);
  } catch (e: any) {
    console.log('Earn positions error:', e.message);
  }

  await p.$disconnect();
}

main().catch(e => console.error('ERROR:', e.message));
