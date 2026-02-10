import { StateGraph, END, START } from '@langchain/langgraph';
import { ChatAnthropic } from '@langchain/anthropic';
import { getBee, BeeOptions, BeeResult } from '../bees';
import type { Transaction, JurisdictionCode, AuditResult } from '@auditswarm/common';

// State interface for the audit workflow
interface AuditState {
  // Input
  auditId: string;
  userId: string;
  walletIds: string[];
  jurisdiction: JurisdictionCode;
  taxYear: number;
  options: BeeOptions;

  // Processing
  transactions: Transaction[];
  currentStep: string;
  progress: number;
  errors: string[];

  // Output
  beeResult?: BeeResult;
  auditResult?: AuditResult;
  completed: boolean;
}

// Node names
const NODES = {
  LOAD_TRANSACTIONS: 'load_transactions',
  VALIDATE_DATA: 'validate_data',
  ROUTE_JURISDICTION: 'route_jurisdiction',
  PROCESS_US: 'process_us',
  PROCESS_EU: 'process_eu',
  PROCESS_BR: 'process_br',
  ANALYZE_RESULTS: 'analyze_results',
  GENERATE_SUMMARY: 'generate_summary',
  SAVE_RESULT: 'save_result',
} as const;

/**
 * Create the audit workflow graph
 */
export function createAuditGraph(dependencies: {
  loadTransactions: (walletIds: string[], taxYear: number) => Promise<Transaction[]>;
  saveResult: (auditId: string, result: AuditResult) => Promise<void>;
  updateProgress: (auditId: string, progress: number, message: string) => Promise<void>;
}) {
  const { loadTransactions, saveResult, updateProgress } = dependencies;

  // Initialize LLM for analysis
  const llm = new ChatAnthropic({
    model: 'claude-3-5-sonnet-20241022',
    temperature: 0,
  });

  // Create the graph
  const graph = new StateGraph<AuditState>({
    channels: {
      auditId: { value: (a: string, b?: string) => b ?? a, default: () => '' },
      userId: { value: (a: string, b?: string) => b ?? a, default: () => '' },
      walletIds: { value: (a: string[], b?: string[]) => b ?? a, default: () => [] },
      jurisdiction: { value: (a: JurisdictionCode, b?: JurisdictionCode) => b ?? a, default: () => 'US' as JurisdictionCode },
      taxYear: { value: (a: number, b?: number) => b ?? a, default: () => new Date().getFullYear() },
      options: { value: (a: BeeOptions, b?: BeeOptions) => b ?? a, default: () => ({}) as BeeOptions },
      transactions: { value: (a: Transaction[], b?: Transaction[]) => b ?? a, default: () => [] },
      currentStep: { value: (a: string, b?: string) => b ?? a, default: () => '' },
      progress: { value: (a: number, b?: number) => b ?? a, default: () => 0 },
      errors: { value: (a: string[], b?: string[]) => [...a, ...(b ?? [])], default: () => [] },
      beeResult: { value: (a?: BeeResult, b?: BeeResult) => b ?? a, default: () => undefined },
      auditResult: { value: (a?: AuditResult, b?: AuditResult) => b ?? a, default: () => undefined },
      completed: { value: (a: boolean, b?: boolean) => b ?? a, default: () => false },
    },
  });

  // Node: Load transactions
  graph.addNode(NODES.LOAD_TRANSACTIONS, async (state: AuditState) => {
    await updateProgress(state.auditId, 10, 'Loading transactions...');

    const transactions = await loadTransactions(state.walletIds, state.taxYear);

    return {
      transactions,
      progress: 20,
      currentStep: NODES.VALIDATE_DATA,
    };
  });

  // Node: Validate data
  graph.addNode(NODES.VALIDATE_DATA, async (state: AuditState) => {
    await updateProgress(state.auditId, 25, 'Validating transaction data...');

    const errors: string[] = [];

    if (state.transactions.length === 0) {
      errors.push('No transactions found for the specified period');
    }

    // Check for required data
    for (const tx of state.transactions) {
      if (!tx.timestamp) {
        errors.push(`Transaction ${tx.signature} missing timestamp`);
      }
    }

    return {
      errors,
      progress: 30,
      currentStep: NODES.ROUTE_JURISDICTION,
    };
  });

  // Node: Route to jurisdiction
  graph.addNode(NODES.ROUTE_JURISDICTION, async (state: AuditState) => {
    await updateProgress(state.auditId, 35, `Routing to ${state.jurisdiction} compliance bee...`);

    return {
      currentStep: `process_${state.jurisdiction.toLowerCase()}`,
    };
  });

  // Node: Process US jurisdiction
  graph.addNode(NODES.PROCESS_US, async (state: AuditState) => {
    await updateProgress(state.auditId, 40, 'Processing with US Tax Compliance Bee...');

    const bee = getBee('US');
    const result = await bee.process(state.transactions, state.taxYear, state.options);

    await updateProgress(state.auditId, 70, 'US tax calculations complete');

    return {
      beeResult: result,
      progress: 70,
      currentStep: NODES.ANALYZE_RESULTS,
    };
  });

  // Node: Process EU jurisdiction
  graph.addNode(NODES.PROCESS_EU, async (state: AuditState) => {
    await updateProgress(state.auditId, 40, 'Processing with EU/MiCA Compliance Bee...');

    const bee = getBee('EU');
    const result = await bee.process(state.transactions, state.taxYear, state.options);

    await updateProgress(state.auditId, 70, 'EU compliance analysis complete');

    return {
      beeResult: result,
      progress: 70,
      currentStep: NODES.ANALYZE_RESULTS,
    };
  });

  // Node: Process BR jurisdiction
  graph.addNode(NODES.PROCESS_BR, async (state: AuditState) => {
    await updateProgress(state.auditId, 40, 'Processing with Brazil Tax Compliance Bee...');

    const bee = getBee('BR');
    const result = await bee.process(state.transactions, state.taxYear, state.options);

    await updateProgress(state.auditId, 70, 'Brazil tax calculations complete');

    return {
      beeResult: result,
      progress: 70,
      currentStep: NODES.ANALYZE_RESULTS,
    };
  });

  // Node: Analyze results with AI
  graph.addNode(NODES.ANALYZE_RESULTS, async (state: AuditState) => {
    await updateProgress(state.auditId, 75, 'Analyzing results...');

    if (!state.beeResult) {
      return { errors: ['No bee result available'] };
    }

    // Use AI to analyze results and generate insights
    const analysisPrompt = `Analyze the following crypto tax audit results for ${state.jurisdiction} jurisdiction:

Capital Gains:
- Short-term gains: $${state.beeResult.capitalGains.shortTermGains}
- Short-term losses: $${state.beeResult.capitalGains.shortTermLosses}
- Long-term gains: $${state.beeResult.capitalGains.longTermGains}
- Long-term losses: $${state.beeResult.capitalGains.longTermLosses}
- Net: $${state.beeResult.capitalGains.totalNet}

Income:
- Staking: $${state.beeResult.income.staking}
- Airdrops: $${state.beeResult.income.airdrops}
- Total: $${state.beeResult.income.total}

Issues found: ${state.beeResult.issues.length}
Estimated tax: $${state.beeResult.estimatedTax}

Provide:
1. A brief summary (2-3 sentences)
2. Any additional recommendations for tax optimization
3. Potential audit risks to be aware of

Format as JSON with keys: summary, recommendations (array), risks (array)`;

    const response = await llm.invoke(analysisPrompt);
    let analysis: { summary: string; recommendations: string[]; risks: string[] };

    try {
      analysis = JSON.parse(response.content as string);
    } catch {
      analysis = {
        summary: 'Audit completed successfully.',
        recommendations: state.beeResult.recommendations,
        risks: [],
      };
    }

    // Merge AI recommendations with bee recommendations
    const allRecommendations = [
      ...state.beeResult.recommendations,
      ...analysis.recommendations,
    ];

    return {
      beeResult: {
        ...state.beeResult,
        recommendations: allRecommendations,
      },
      progress: 85,
      currentStep: NODES.GENERATE_SUMMARY,
    };
  });

  // Node: Generate final summary
  graph.addNode(NODES.GENERATE_SUMMARY, async (state: AuditState) => {
    await updateProgress(state.auditId, 90, 'Generating audit report...');

    if (!state.beeResult) {
      return { errors: ['No bee result available'] };
    }

    const auditResult: AuditResult = {
      id: `result-${state.auditId}`,
      auditId: state.auditId,
      jurisdiction: state.jurisdiction,
      taxYear: state.taxYear,
      summary: {
        totalTransactions: state.transactions.length,
        totalWallets: state.walletIds.length,
        periodStart: new Date(state.taxYear, 0, 1),
        periodEnd: new Date(state.taxYear, 11, 31),
        netGainLoss: state.beeResult.capitalGains.totalNet,
        totalIncome: state.beeResult.income.total,
        estimatedTax: state.beeResult.estimatedTax,
        currency: state.options.currency || 'USD',
      },
      capitalGains: state.beeResult.capitalGains,
      income: state.beeResult.income,
      holdings: state.beeResult.holdings,
      issues: state.beeResult.issues,
      recommendations: state.beeResult.recommendations,
      metadata: {
        version: '1.0.0',
        beeVersion: '1.0.0',
        jurisdiction: state.jurisdiction,
        costBasisMethod: state.options.costBasisMethod,
        dataSource: 'helius',
        processedAt: new Date(),
        processingTime: 0, // Will be calculated
      },
    };

    return {
      auditResult,
      progress: 95,
      currentStep: NODES.SAVE_RESULT,
    };
  });

  // Node: Save result
  graph.addNode(NODES.SAVE_RESULT, async (state: AuditState) => {
    await updateProgress(state.auditId, 98, 'Saving audit result...');

    if (state.auditResult) {
      await saveResult(state.auditId, state.auditResult);
    }

    await updateProgress(state.auditId, 100, 'Audit complete');

    return {
      completed: true,
      progress: 100,
    };
  });

  // Define edges (type assertions needed for LangGraph 0.2.x API compat)
  const g = graph as any;
  g.addEdge(START, NODES.LOAD_TRANSACTIONS);
  g.addEdge(NODES.LOAD_TRANSACTIONS, NODES.VALIDATE_DATA);
  g.addEdge(NODES.VALIDATE_DATA, NODES.ROUTE_JURISDICTION);

  // Conditional routing based on jurisdiction
  g.addConditionalEdges(NODES.ROUTE_JURISDICTION, (state: AuditState) => {
    if (state.errors.length > 0) {
      return END;
    }

    switch (state.jurisdiction) {
      case 'US':
        return NODES.PROCESS_US;
      case 'EU':
        return NODES.PROCESS_EU;
      case 'BR':
        return NODES.PROCESS_BR;
      default:
        return END;
    }
  });

  // Connect jurisdiction processors to analysis
  g.addEdge(NODES.PROCESS_US, NODES.ANALYZE_RESULTS);
  g.addEdge(NODES.PROCESS_EU, NODES.ANALYZE_RESULTS);
  g.addEdge(NODES.PROCESS_BR, NODES.ANALYZE_RESULTS);

  g.addEdge(NODES.ANALYZE_RESULTS, NODES.GENERATE_SUMMARY);
  g.addEdge(NODES.GENERATE_SUMMARY, NODES.SAVE_RESULT);
  g.addEdge(NODES.SAVE_RESULT, END);

  return graph.compile();
}

export type AuditGraph = ReturnType<typeof createAuditGraph>;
