import { Logger } from '@nestjs/common';
import { ExchangeAdapter, ExchangeRecord } from './base-adapter';

// Dynamic import to avoid hard dependency on @anthropic-ai/sdk
type AnthropicClient = { messages: { create: (opts: any) => Promise<any> } };

interface ColumnMapping {
  timestamp: string;
  type: string;
  asset: string;
  amount: string;
  price?: string;
  total?: string;
  fee?: string;
  feeAsset?: string;
  side?: string;
  pair?: string;
  id?: string;
  confidence: number;
}

export class GenericAdapter implements ExchangeAdapter {
  readonly exchangeName: string;
  private readonly logger = new Logger(GenericAdapter.name);
  private anthropic: AnthropicClient | null;

  constructor(exchangeName: string, anthropicApiKey?: string) {
    this.exchangeName = exchangeName;
    this.anthropic = null;
    if (anthropicApiKey) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Anthropic = require('@anthropic-ai/sdk').default;
        this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
      } catch {
        this.logger.debug('Anthropic SDK not available — generic adapter will use heuristic parsing');
      }
    }
  }

  parse(csvContent: string): ExchangeRecord[] {
    // Synchronous fallback — just parse with best-guess column names
    return this.parseWithMapping(csvContent, this.guessMapping(csvContent));
  }

  async parseAsync(csvContent: string): Promise<{ records: ExchangeRecord[]; confidence: number }> {
    const lines = csvContent.split('\n').filter(l => l.trim());
    if (lines.length < 2) return { records: [], confidence: 0 };

    // Try LLM column mapping
    if (this.anthropic) {
      const sampleRows = lines.slice(0, 6).join('\n');
      const mapping = await this.getColumnMapping(sampleRows);

      if (mapping && mapping.confidence >= 0.8) {
        const records = this.parseWithMapping(csvContent, mapping);
        return { records, confidence: mapping.confidence };
      }

      // Second pass if confidence < 0.8
      if (mapping && mapping.confidence >= 0.5) {
        const verifiedMapping = await this.verifyMapping(sampleRows, mapping);
        if (verifiedMapping && verifiedMapping.confidence >= 0.7) {
          const records = this.parseWithMapping(csvContent, verifiedMapping);
          return { records, confidence: verifiedMapping.confidence };
        }
      }
    }

    // Fallback: best-guess parsing
    const guessedMapping = this.guessMapping(csvContent);
    const records = this.parseWithMapping(csvContent, guessedMapping);
    return { records, confidence: guessedMapping.confidence };
  }

  private async getColumnMapping(sampleRows: string): Promise<ColumnMapping | null> {
    if (!this.anthropic) return null;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: `Map the columns of this exchange CSV to standard fields. Return ONLY valid JSON.

CSV sample:
${sampleRows}

Map to these fields (use column header names):
{
  "timestamp": "column name for date/time",
  "type": "column name for transaction type",
  "asset": "column name for asset/coin/currency",
  "amount": "column name for amount/quantity",
  "price": "column name for price (optional)",
  "total": "column name for total value (optional)",
  "fee": "column name for fee (optional)",
  "feeAsset": "column name for fee currency (optional)",
  "side": "column name for buy/sell side (optional)",
  "pair": "column name for trading pair (optional)",
  "id": "column name for transaction ID (optional)",
  "confidence": 0.0-1.0
}`,
          },
        ],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      return JSON.parse(text);
    } catch (error) {
      this.logger.debug(`LLM column mapping failed: ${error}`);
      return null;
    }
  }

  private async verifyMapping(sampleRows: string, mapping: ColumnMapping): Promise<ColumnMapping | null> {
    if (!this.anthropic) return null;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: `Verify this column mapping for an exchange CSV. Correct any errors.

CSV sample:
${sampleRows}

Current mapping:
${JSON.stringify(mapping, null, 2)}

Return corrected mapping as JSON with updated confidence score.`,
          },
        ],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      return JSON.parse(text);
    } catch (error) {
      this.logger.debug(`LLM verification failed: ${error}`);
      return mapping;
    }
  }

  private guessMapping(csvContent: string): ColumnMapping {
    const lines = csvContent.split('\n').filter(l => l.trim());
    if (lines.length === 0) return { timestamp: '', type: '', asset: '', amount: '', confidence: 0 };

    const headers = this.parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());

    const find = (keywords: string[]): string => {
      for (const kw of keywords) {
        const match = headers.find(h => h.includes(kw));
        if (match) return match;
      }
      return '';
    };

    return {
      timestamp: find(['time', 'date', 'utc']),
      type: find(['type', 'operation', 'action']),
      asset: find(['coin', 'asset', 'currency', 'symbol']),
      amount: find(['amount', 'quantity', 'change', 'size']),
      price: find(['price', 'rate']) || undefined,
      total: find(['total', 'subtotal', 'value']) || undefined,
      fee: find(['fee', 'commission', 'spread']) || undefined,
      side: find(['side', 'direction']) || undefined,
      pair: find(['pair', 'market', 'symbol']) || undefined,
      id: find(['id', 'order', 'transaction']) || undefined,
      confidence: 0.4,
    };
  }

  private parseWithMapping(csvContent: string, mapping: ColumnMapping): ExchangeRecord[] {
    const lines = csvContent.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];

    const headers = this.parseCSVLine(lines[0]).map(h => h.trim());
    const headersLower = headers.map(h => h.toLowerCase());
    const records: ExchangeRecord[] = [];

    const colIndex = (name: string | undefined): number => {
      if (!name) return -1;
      return headersLower.indexOf(name.toLowerCase());
    };

    const tIdx = colIndex(mapping.timestamp);
    const typeIdx = colIndex(mapping.type);
    const assetIdx = colIndex(mapping.asset);
    const amountIdx = colIndex(mapping.amount);
    const priceIdx = colIndex(mapping.price);
    const totalIdx = colIndex(mapping.total);
    const feeIdx = colIndex(mapping.fee);
    const sideIdx = colIndex(mapping.side);
    const idIdx = colIndex(mapping.id);

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length < 2) continue;

      const get = (idx: number) => idx >= 0 && idx < values.length ? values[idx].trim() : '';

      const timestamp = get(tIdx);
      const asset = get(assetIdx);
      const amount = parseFloat(get(amountIdx) || '0');
      if (!timestamp || !asset || isNaN(amount)) continue;

      const typeStr = get(typeIdx).toLowerCase();
      let type: ExchangeRecord['type'] = 'TRADE';
      if (typeStr.includes('deposit') || typeStr.includes('receive')) type = 'DEPOSIT';
      else if (typeStr.includes('withdraw') || typeStr.includes('send')) type = 'WITHDRAWAL';
      else if (typeStr.includes('fee')) type = 'FEE';

      records.push({
        externalId: get(idIdx) || undefined,
        type,
        timestamp: new Date(timestamp),
        asset,
        amount: Math.abs(amount),
        priceUsd: priceIdx >= 0 ? parseFloat(get(priceIdx)) || undefined : undefined,
        totalValueUsd: totalIdx >= 0 ? parseFloat(get(totalIdx)) || undefined : undefined,
        feeAmount: feeIdx >= 0 ? parseFloat(get(feeIdx)) || undefined : undefined,
        side: sideIdx >= 0 ? (get(sideIdx).toUpperCase() as 'BUY' | 'SELL') : undefined,
        rawData: Object.fromEntries(headers.map((h, idx) => [h, values[idx]?.trim()])),
      });
    }

    return records;
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
