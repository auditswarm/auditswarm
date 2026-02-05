export const QUEUES = {
  AUDIT: 'audit',
  REPORT: 'report',
  ATTESTATION: 'attestation',
  INDEXER: 'indexer',
  NOTIFICATION: 'notification',
} as const;

export type QueueName = typeof QUEUES[keyof typeof QUEUES];

export const JOB_NAMES = {
  // Audit jobs
  PROCESS_AUDIT: 'process-audit',
  CALCULATE_TAX: 'calculate-tax',
  ANALYZE_TRANSACTIONS: 'analyze-transactions',

  // Report jobs
  GENERATE_PDF: 'generate-pdf',
  GENERATE_CSV: 'generate-csv',
  GENERATE_XLSX: 'generate-xlsx',

  // Attestation jobs
  CREATE_ATTESTATION: 'create-attestation',
  VERIFY_ATTESTATION: 'verify-attestation',

  // Indexer jobs
  INDEX_WALLET: 'index-wallet',
  INDEX_TRANSACTION: 'index-transaction',
  SYNC_WALLET: 'sync-wallet',

  // Notification jobs
  SEND_EMAIL: 'send-email',
  SEND_WEBHOOK: 'send-webhook',
} as const;
