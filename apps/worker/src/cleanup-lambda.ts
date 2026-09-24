import { CONTENT_VERSION } from '@tarot/content';
import { createTarotRepository, DynamoTarotRepository } from '@tarot/database';
import { loadLambdaConfig } from '@tarot/runtime';

export async function handler() {
  const config = await loadLambdaConfig();
  const repository = createTarotRepository({
    STORAGE_DRIVER: config.STORAGE_DRIVER,
    DATABASE_URL: config.DATABASE_URL,
    READINGS_TABLE: config.READINGS_TABLE,
    CONTENT_TABLE: config.CONTENT_TABLE,
    RATE_LIMITS_TABLE: config.RATE_LIMITS_TABLE,
    AGENT_QUEUE_URL: config.AGENT_QUEUE_URL,
    contentVersion: CONTENT_VERSION,
  });
  if (!(repository instanceof DynamoTarotRepository)) {
    throw new Error('Cleanup Lambda requires DynamoDB storage.');
  }
  await repository.cleanupExpired();
  await repository.recoverPendingDispatches();
  return { status: 'ok' };
}
