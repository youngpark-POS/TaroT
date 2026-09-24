import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { CONTENT_VERSION } from '@tarot/content';
import {
  createTarotRepository,
  type AgentJobMessage,
  type TarotRepositoryPort,
} from '@tarot/database';
import { loadLambdaConfig, type AppConfig } from '@tarot/runtime';
import { createAgentJobProcessor } from './jobs.js';

let initialized:
  | Promise<{
      config: AppConfig;
      repository: TarotRepositoryPort;
      processor: ReturnType<typeof createAgentJobProcessor>;
    }>
  | undefined;

async function initialize() {
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
  return { config, repository, processor: createAgentJobProcessor(config, repository) };
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  initialized ??= initialize();
  const { repository, processor } = await initialized;
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    let message: AgentJobMessage | undefined;
    try {
      message = JSON.parse(record.body) as AgentJobMessage;
      if (!['recommend_spread', 'interpret_reading'].includes(message.type)) {
        throw new Error('Unsupported agent job type.');
      }
      await processor.process(message);
    } catch (error) {
      const attempts = Number(record.attributes.ApproximateReceiveCount ?? '1');
      const refused = error instanceof Error && error.name === 'ModelRefusalError';
      console.error(
        JSON.stringify({
          event: 'agent_job_failed',
          messageId: record.messageId,
          jobType: message?.type,
          readingId: message?.readingId,
          attempts,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
      if (message && refused) {
        const reading = await repository.getReading(message.readingId);
        if (reading) await repository.updateReading(reading.id, { status: 'failed' });
        await repository.completeAgentJob(message.type, message.readingId, message.version);
        continue;
      }
      if (message && attempts >= 3) {
        try {
          await processor.fallback(message);
          continue;
        } catch (fallbackError) {
          const reading = await repository.getReading(message.readingId);
          if (reading) {
            await repository.updateReading(reading.id, {
              status: 'failed',
            });
          }
          console.error(
            JSON.stringify({
              event: 'agent_fallback_failed',
              messageId: record.messageId,
              errorType:
                fallbackError instanceof Error ? fallbackError.name : 'UnknownFallbackError',
            }),
          );
        }
      }
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
