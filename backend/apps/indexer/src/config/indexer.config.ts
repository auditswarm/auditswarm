import { registerAs } from '@nestjs/config';

export default registerAs('indexer', () => ({
  concurrency: parseInt(process.env.INDEXER_CONCURRENCY || '5', 10),
  batchSize: parseInt(process.env.INDEXER_BATCH_SIZE || '100', 10),
  signatureLimit: parseInt(process.env.INDEXER_SIGNATURE_LIMIT || '1000', 10),
}));
