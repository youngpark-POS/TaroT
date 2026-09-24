import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { SQSClient } from '@aws-sdk/client-sqs';
import { describe, expect, it } from 'vitest';
import { DynamoTarotRepository } from './dynamo.js';

function repository(send: (command: { input: Record<string, unknown> }) => Promise<unknown>) {
  return new DynamoTarotRepository({
    readingsTable: 'readings',
    contentTable: 'content',
    rateLimitsTable: 'rate-limits',
    queueUrl: 'https://sqs.ap-northeast-2.amazonaws.com/123/jobs',
    contentVersion: 'test',
    dynamo: { send } as unknown as DynamoDBDocumentClient,
    sqs: { send: async () => ({}) } as unknown as SQSClient,
  });
}

describe('DynamoTarotRepository', () => {
  it('uses a conditional reveal update to reject concurrent state changes', async () => {
    let input: Record<string, unknown> | undefined;
    const repo = repository(async (command) => {
      input = command.input;
      return {};
    });

    const updated = await repo.updateReading(
      '11111111-1111-4111-8111-111111111111',
      { status: 'revealing' },
      { status: 'revealing', revealedCount: 2 },
    );

    expect(updated).toBe(true);
    expect(input?.ConditionExpression).toContain('#status = :expectedStatus');
    expect(input?.ConditionExpression).toContain('#state.#revealedCount = :expectedRevealedCount');
  });

  it('advances only the reveal counter instead of replacing concurrent interpretation state', async () => {
    let input: Record<string, unknown> | undefined;
    const repo = repository(async (command) => {
      input = command.input;
      return {};
    });

    await expect(repo.advanceReveal('reading', 1, 2, false)).resolves.toBe('revealing');
    expect(input?.UpdateExpression).toContain('#state.#revealedCount = :nextRevealedCount');
    expect(input?.UpdateExpression).not.toContain('#state =');
  });

  it('claims an agent job only once while its lease is active', async () => {
    let calls = 0;
    const repo = repository(async () => {
      calls += 1;
      if (calls === 2) {
        const error = new Error('duplicate');
        error.name = 'ConditionalCheckFailedException';
        throw error;
      }
      return {};
    });

    await expect(repo.claimAgentJob('interpret_reading', 'reading', 1)).resolves.toBe(true);
    await expect(repo.claimAgentJob('interpret_reading', 'reading', 1)).resolves.toBe(false);
  });

  it('stores a prepared result with nested atomic fields', async () => {
    const inputs: Record<string, unknown>[] = [];
    const repo = repository(async (command) => {
      inputs.push(command.input);
      if ('Key' in command.input && !('UpdateExpression' in command.input)) {
        return {
          Item: {
            id: 'reading',
            sessionHash: 'session',
            status: 'revealing',
            questionEncrypted: 'encrypted',
            resultEncrypted: 'encrypted-result',
            state: {
              highRisk: false,
              crisis: false,
              clarificationQuestion: null,
              clarificationUsed: false,
              recommendations: [],
              selectedSpreadId: 'single-insight',
              draw: [{ positionIndex: 0, cardId: 'fool', orientation: 'upright' }],
              revealedCount: 0,
              interpretationJobVersion: 1,
            },
            contentVersion: 'test',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        };
      }
      return {};
    });

    await repo.savePreparedInterpretation('reading', 'encrypted-result', 1);
    expect(inputs[0]?.UpdateExpression).toContain('#state.#interpretationStatus = :completed');
    expect(inputs[0]?.UpdateExpression).not.toContain('#state =');
  });

  it('treats an expired item as unavailable even before DynamoDB TTL removes it', async () => {
    const repo = repository(async () => ({
      Item: {
        id: '11111111-1111-4111-8111-111111111111',
        sessionHash: 'session',
        status: 'awaiting_spread',
        questionEncrypted: 'encrypted',
        state: {
          highRisk: false,
          crisis: false,
          clarificationQuestion: null,
          clarificationUsed: false,
          recommendations: [],
          selectedSpreadId: null,
          draw: [],
          revealedCount: 0,
        },
        contentVersion: 'test',
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }));

    await expect(repo.getReading('11111111-1111-4111-8111-111111111111')).resolves.toBeNull();
  });
});
