import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CounterpartyWalletRepository,
  KnownAddressRepository,
  WalletInteractionRepository,
} from '@auditswarm/database';
// Dynamic import to avoid hard dependency on @anthropic-ai/sdk
type AnthropicClient = { messages: { create: (opts: any) => Promise<any> } };


@Injectable()
export class CounterpartyAnalysisService {
  private readonly logger = new Logger(CounterpartyAnalysisService.name);
  private anthropic: AnthropicClient | null = null;

  constructor(
    private counterpartyRepo: CounterpartyWalletRepository,
    private knownAddressRepo: KnownAddressRepository,
    private interactionRepo: WalletInteractionRepository,
    private configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Anthropic = require('@anthropic-ai/sdk').default;
        this.anthropic = new Anthropic({ apiKey });
      } catch {
        this.logger.warn('Anthropic SDK not available — counterparty LLM analysis disabled');
      }
    }
  }

  async analyzeCounterparties(
    userId: string,
    walletId: string,
    counterpartyIds: string[],
  ): Promise<{ labeled: number; skipped: number }> {
    this.logger.log(`Analyzing ${counterpartyIds.length} counterparties for wallet ${walletId}`);

    let labeled = 0;
    let skipped = 0;

    // If no specific IDs, find unlabeled counterparties
    let idsToAnalyze = counterpartyIds;
    if (idsToAnalyze.length === 0) {
      const unlabeled = await this.counterpartyRepo.findUnlabeled(walletId, 20);
      idsToAnalyze = unlabeled.map(c => c.id);
    }

    for (const counterpartyId of idsToAnalyze) {
      try {
        const counterparty = await this.counterpartyRepo.findById(counterpartyId);
        if (!counterparty || counterparty.label) {
          skipped++;
          continue;
        }

        // 1. Check known address DB first
        const knownAddr = await this.knownAddressRepo.findByAddress(counterparty.address);
        if (knownAddr) {
          await this.counterpartyRepo.upsert(counterparty.address, {
            label: knownAddr.label,
            labelSource: 'AUTO_EXCHANGE',
            entityType: knownAddr.entityType,
          });
          labeled++;
          continue;
        }

        // 2. LLM analysis if available
        if (!this.anthropic) {
          skipped++;
          continue;
        }

        const result = await this.analyzeWithLLM(counterparty);
        if (result && result.confidence > 0.7) {
          await this.counterpartyRepo.upsert(counterparty.address, {
            label: result.label,
            labelSource: 'AI',
            entityType: result.entityType,
          });
          labeled++;
        } else {
          skipped++;
        }
      } catch (error) {
        this.logger.warn(`Failed to analyze counterparty ${counterpartyId}: ${error}`);
        skipped++;
      }
    }

    this.logger.log(
      `Counterparty analysis complete: ${labeled} labeled, ${skipped} skipped`,
    );

    return { labeled, skipped };
  }

  private async analyzeWithLLM(counterparty: any): Promise<{
    entityType: string;
    label: string;
    confidence: number;
  } | null> {
    if (!this.anthropic) return null;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [
          {
            role: 'user',
            content: `Classify this Solana wallet address for crypto tax purposes.

Address: ${counterparty.address}
Total interactions: ${counterparty.interactionCount}
Known program: ${counterparty.isKnownProgram ? 'Yes' : 'No'}
Program ID: ${counterparty.programId ?? 'N/A'}

Respond with ONLY valid JSON:
{
  "entityType": "EXCHANGE|DEX|LENDING|STAKING|BRIDGE|NFT_MARKETPLACE|DAO|PERSONAL|BUSINESS|UNKNOWN",
  "label": "Human-readable label (e.g. 'Jupiter Aggregator', 'Unknown DEX')",
  "confidence": 0.0-1.0
}`,
          },
        ],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const parsed = JSON.parse(text);

      if (parsed.entityType && parsed.label && typeof parsed.confidence === 'number') {
        return parsed;
      }
    } catch (error) {
      this.logger.debug(`LLM analysis failed for ${counterparty.address}: ${error}`);
    }

    return null;
  }
}
