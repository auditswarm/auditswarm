import { ExchangeAdapter, ExchangeRecord } from './base-adapter';

export class BinanceAdapter implements ExchangeAdapter {
  readonly exchangeName = 'Binance';

  parse(csvContent: string): ExchangeRecord[] {
    const lines = csvContent.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];

    const headers = this.parseCSVLine(lines[0]);
    const records: ExchangeRecord[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length < headers.length) continue;

      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h.trim()] = values[idx]?.trim() ?? ''; });

      const type = this.mapType(row['Operation'] || row['Type']);
      if (!type) continue;

      const timestamp = row['UTC_Time'] || row['Date(UTC)'] || row['Time'];
      const asset = row['Coin'] || row['Asset'] || '';
      const amount = Math.abs(parseFloat(row['Change'] || row['Amount'] || row['Quantity'] || '0'));

      records.push({
        externalId: row['Order ID'] || row['Transaction ID'] || undefined,
        type,
        timestamp: new Date(timestamp),
        asset,
        amount,
        priceUsd: row['Price'] ? parseFloat(row['Price']) : undefined,
        totalValueUsd: row['Total'] ? parseFloat(row['Total']) : undefined,
        feeAmount: row['Fee'] ? parseFloat(row['Fee']) : undefined,
        feeAsset: row['Fee Coin'] || row['Fee Asset'] || undefined,
        side: type === 'TRADE' ? (parseFloat(row['Change'] || row['Amount'] || '0') > 0 ? 'BUY' : 'SELL') : undefined,
        tradePair: row['Pair'] || row['Market'] || undefined,
        rawData: row,
      });
    }

    return records;
  }

  private mapType(operation: string): ExchangeRecord['type'] | null {
    if (!operation) return null;
    const op = operation.toLowerCase();
    if (op.includes('buy') || op.includes('sell') || op.includes('trade') || op.includes('spot')) return 'TRADE';
    if (op.includes('deposit') || op.includes('distribution') || op.includes('staking rewards')) return 'DEPOSIT';
    if (op.includes('withdraw')) return 'WITHDRAWAL';
    if (op.includes('fee') || op.includes('commission')) return 'FEE';
    return 'TRADE'; // Default for Binance as most entries are trades
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
