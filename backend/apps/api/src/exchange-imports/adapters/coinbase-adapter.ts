import { ExchangeAdapter, ExchangeRecord } from './base-adapter';

export class CoinbaseAdapter implements ExchangeAdapter {
  readonly exchangeName = 'Coinbase';

  parse(csvContent: string): ExchangeRecord[] {
    const lines = csvContent.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];

    // Skip header rows — Coinbase CSVs often have metadata before the actual header
    let headerIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('Timestamp') && lines[i].includes('Transaction Type')) {
        headerIndex = i;
        break;
      }
    }

    const headers = this.parseCSVLine(lines[headerIndex]);
    const records: ExchangeRecord[] = [];

    for (let i = headerIndex + 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length < headers.length) continue;

      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h.trim()] = values[idx]?.trim() ?? ''; });

      const type = this.mapType(row['Transaction Type']);
      if (!type) continue;

      records.push({
        externalId: row['ID'] || undefined,
        type,
        timestamp: new Date(row['Timestamp']),
        asset: row['Asset'] || row['Currency'] || '',
        amount: Math.abs(parseFloat(row['Quantity Transacted'] || row['Amount'] || '0')),
        priceUsd: row['Spot Price at Transaction'] ? parseFloat(row['Spot Price at Transaction']) : undefined,
        totalValueUsd: row['Subtotal'] ? parseFloat(row['Subtotal']) : undefined,
        feeAmount: row['Fees and/or Spread'] ? parseFloat(row['Fees and/or Spread']) : undefined,
        feeAsset: row['Spot Price Currency'] || 'USD',
        side: type === 'TRADE' ? (row['Transaction Type']?.includes('Buy') ? 'BUY' : 'SELL') : undefined,
        rawData: row,
      });
    }

    return records;
  }

  private mapType(txType: string): ExchangeRecord['type'] | null {
    if (!txType) return null;
    const t = txType.toLowerCase();
    if (t.includes('buy') || t.includes('sell') || t.includes('convert') || t.includes('trade')) return 'TRADE';
    if (t.includes('send')) return 'WITHDRAWAL';
    if (t.includes('receive')) return 'DEPOSIT';
    if (t.includes('fee')) return 'FEE';
    if (t.includes('reward') || t.includes('staking') || t.includes('interest')) return 'DEPOSIT';
    return null;
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
