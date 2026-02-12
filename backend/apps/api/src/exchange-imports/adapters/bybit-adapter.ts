import { ExchangeAdapter, ExchangeRecord } from './base-adapter';

export class BybitAdapter implements ExchangeAdapter {
  readonly exchangeName = 'Bybit';

  parse(csvContent: string): ExchangeRecord[] {
    const lines = csvContent.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];

    // Bybit CSVs may have metadata rows — scan for header row
    let headerIdx = 0;
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const lower = lines[i].toLowerCase();
      if (lower.includes('time') && (lower.includes('coin') || lower.includes('type') || lower.includes('amount'))) {
        headerIdx = i;
        break;
      }
    }

    const headers = this.parseCSVLine(lines[headerIdx]);
    const records: ExchangeRecord[] = [];

    for (let i = headerIdx + 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length < headers.length) continue;

      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h.trim()] = values[idx]?.trim() ?? ''; });

      const type = this.mapType(row['Type'] || row['Operation'] || row['Category']);
      if (!type) continue;

      const timestamp = row['Time'] || row['Time(UTC)'] || row['Date'] || row['Created Time'];
      const asset = row['Coin'] || row['Asset'] || row['Currency'] || '';
      const amount = Math.abs(parseFloat(row['Amount'] || row['Quantity'] || row['Change'] || '0'));

      records.push({
        externalId: row['Order ID'] || row['Transaction ID'] || row['TxID'] || undefined,
        type,
        timestamp: new Date(timestamp),
        asset,
        amount,
        priceUsd: row['Price'] ? parseFloat(row['Price']) : undefined,
        totalValueUsd: row['Total'] || row['Value'] ? parseFloat(row['Total'] || row['Value']) : undefined,
        feeAmount: row['Fee'] ? Math.abs(parseFloat(row['Fee'])) : undefined,
        feeAsset: row['Fee Coin'] || row['Fee Currency'] || undefined,
        side: type === 'TRADE' ? (parseFloat(row['Amount'] || row['Change'] || '0') > 0 ? 'BUY' : 'SELL') : undefined,
        tradePair: row['Pair'] || row['Symbol'] || row['Market'] || undefined,
        network: row['Chain'] || row['Network'] || undefined,
        txId: row['TxID'] || row['Transaction Hash'] || undefined,
        rawData: row,
      });
    }

    return records;
  }

  private mapType(operation: string): ExchangeRecord['type'] | null {
    if (!operation) return null;
    const op = operation.toLowerCase();
    if (op.includes('trade') || op.includes('spot') || op.includes('buy') || op.includes('sell')) return 'TRADE';
    if (op.includes('deposit')) return 'DEPOSIT';
    if (op.includes('withdraw')) return 'WITHDRAWAL';
    if (op.includes('convert') || op.includes('exchange')) return 'CONVERT';
    if (op.includes('p2p') || op.includes('c2c')) return 'C2C_TRADE';
    if (op.includes('stake') || op.includes('subscribe')) return 'STAKE';
    if (op.includes('unstake') || op.includes('redeem')) return 'UNSTAKE';
    if (op.includes('interest') || op.includes('reward') || op.includes('yield')) return 'INTEREST';
    if (op.includes('dividend') || op.includes('airdrop') || op.includes('bonus')) return 'DIVIDEND';
    if (op.includes('fee') || op.includes('commission')) return 'FEE';
    if (op.includes('borrow')) return 'MARGIN_BORROW';
    if (op.includes('repay')) return 'MARGIN_REPAY';
    return 'TRADE'; // Default
  }

  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }
}
