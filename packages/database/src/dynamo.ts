import { createHash, randomUUID } from 'node:crypto';
import type { ReadingStatus, Spread, SpreadAgentOutput, TarotCard } from '@tarot/contracts';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type {
  ReadingUpdateCondition,
  StoredReading,
  StoredReadingState,
  TarotRepositoryPort,
} from './index.js';

export type AgentJobType = 'recommend_spread' | 'interpret_reading';

export interface AgentJobMessage {
  type: AgentJobType;
  readingId: string;
  version: number;
}

interface DynamoRepositoryOptions {
  readingsTable: string;
  contentTable: string;
  rateLimitsTable: string;
  queueUrl: string;
  contentVersion: string;
  dynamo?: DynamoDBDocumentClient;
  sqs?: SQSClient;
}

const readingKey = (id: string) => `READING#${id}`;
const agentJobKey = (type: AgentJobType, readingId: string, version: number) =>
  `AGENT_JOB#${type}#${readingId}#${version}`;
const idempotencyKey = (readingId: string, key: string) =>
  `IDEMPOTENCY#${readingId}#${createHash('sha256').update(key).digest('hex')}`;
const expiryShard = (date: Date) => date.toISOString().slice(0, 10);

function fromReadingItem(item: Record<string, unknown>): StoredReading {
  return {
    id: item.id as string,
    sessionHash: item.sessionHash as string,
    status: item.status as ReadingStatus,
    questionEncrypted: item.questionEncrypted as string,
    clarificationEncrypted: (item.clarificationEncrypted as string | undefined) ?? null,
    resultEncrypted: (item.resultEncrypted as string | undefined) ?? null,
    state: item.state as StoredReadingState,
    contentVersion: item.contentVersion as string,
    expiresAt: new Date(item.expiresAt as string),
    createdAt: new Date(item.createdAt as string),
    updatedAt: new Date(item.updatedAt as string),
  };
}

function conditionalFailure(error: unknown) {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

export class DynamoTarotRepository implements TarotRepositoryPort {
  readonly asyncAgents = true;
  private readonly dynamo: DynamoDBDocumentClient;
  private readonly sqs: SQSClient;

  constructor(private readonly options: DynamoRepositoryOptions) {
    this.dynamo =
      options.dynamo ??
      DynamoDBDocumentClient.from(new DynamoDBClient({}), {
        marshallOptions: { removeUndefinedValues: true },
      });
    this.sqs = options.sqs ?? new SQSClient({});
  }

  async close() {}

  async isReady() {
    await this.dynamo.send(
      new QueryCommand({
        TableName: this.options.contentTable,
        KeyConditionExpression: 'contentVersion = :version',
        ExpressionAttributeValues: { ':version': this.options.contentVersion },
        Limit: 1,
      }),
    );
  }

  private async listContent<T>(prefix: string): Promise<T[]> {
    const response = await this.dynamo.send(
      new QueryCommand({
        TableName: this.options.contentTable,
        KeyConditionExpression: 'contentVersion = :version AND begins_with(entityKey, :prefix)',
        ExpressionAttributeValues: {
          ':version': this.options.contentVersion,
          ':prefix': prefix,
        },
      }),
    );
    return (response.Items ?? []).map((item) => item.data as T);
  }

  async listCards() {
    return this.listContent<TarotCard>('CARD#');
  }

  async listSpreads() {
    return this.listContent<Spread>('SPREAD#');
  }

  private async getContent<T>(entityKey: string): Promise<T | null> {
    const response = await this.dynamo.send(
      new GetCommand({
        TableName: this.options.contentTable,
        Key: { contentVersion: this.options.contentVersion, entityKey },
      }),
    );
    return (response.Item?.data as T | undefined) ?? null;
  }

  async getCard(id: string) {
    return this.getContent<TarotCard>(`CARD#${id}`);
  }

  async getSpread(id: string) {
    return this.getContent<Spread>(`SPREAD#${id}`);
  }

  async createReading(reading: StoredReading) {
    await this.dynamo.send(
      new PutCommand({
        TableName: this.options.readingsTable,
        Item: {
          pk: readingKey(reading.id),
          entityType: 'reading',
          ...reading,
          expiresAt: reading.expiresAt.toISOString(),
          expiresAtEpoch: Math.floor(reading.expiresAt.getTime() / 1_000),
          expiryShard: expiryShard(reading.expiresAt),
          createdAt: reading.createdAt.toISOString(),
          updatedAt: reading.updatedAt.toISOString(),
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  }

  async getReading(id: string, sessionHash?: string): Promise<StoredReading | null> {
    const response = await this.dynamo.send(
      new GetCommand({
        TableName: this.options.readingsTable,
        Key: { pk: readingKey(id) },
        ConsistentRead: true,
      }),
    );
    if (!response.Item) return null;
    const reading = fromReadingItem(response.Item);
    if (reading.expiresAt.getTime() <= Date.now()) return null;
    if (sessionHash && reading.sessionHash !== sessionHash) return null;
    return reading;
  }

  async updateReading(
    id: string,
    values: Partial<
      Pick<StoredReading, 'status' | 'state' | 'clarificationEncrypted' | 'resultEncrypted'>
    >,
    condition?: ReadingUpdateCondition,
  ) {
    const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
    const valueMap: Record<string, unknown> = { ':updatedAt': new Date().toISOString() };
    const sets = ['#updatedAt = :updatedAt'];
    for (const [key, value] of Object.entries(values)) {
      names[`#${key}`] = key;
      valueMap[`:${key}`] = value;
      sets.push(`#${key} = :${key}`);
    }
    const conditions = ['attribute_exists(pk)'];
    if (condition?.status) {
      names['#status'] = 'status';
      valueMap[':expectedStatus'] = condition.status;
      conditions.push('#status = :expectedStatus');
    }
    if (condition?.revealedCount !== undefined) {
      names['#state'] = 'state';
      names['#revealedCount'] = 'revealedCount';
      valueMap[':expectedRevealedCount'] = condition.revealedCount;
      conditions.push('#state.#revealedCount = :expectedRevealedCount');
    }
    try {
      await this.dynamo.send(
        new UpdateCommand({
          TableName: this.options.readingsTable,
          Key: { pk: readingKey(id) },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ConditionExpression: conditions.join(' AND '),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: valueMap,
        }),
      );
      return true;
    } catch (error) {
      if (conditionalFailure(error)) return false;
      throw error;
    }
  }

  async advanceReveal(
    readingId: string,
    expectedRevealedCount: number,
    nextRevealedCount: number,
    finished: boolean,
  ): Promise<'revealing' | 'interpreting' | 'completed' | null> {
    try {
      await this.dynamo.send(
        new UpdateCommand({
          TableName: this.options.readingsTable,
          Key: { pk: readingKey(readingId) },
          UpdateExpression:
            'SET #state.#revealedCount = :nextRevealedCount, #updatedAt = :updatedAt',
          ConditionExpression:
            '#status = :revealing AND #state.#revealedCount = :expectedRevealedCount',
          ExpressionAttributeNames: {
            '#state': 'state',
            '#revealedCount': 'revealedCount',
            '#status': 'status',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':revealing': 'revealing',
            ':expectedRevealedCount': expectedRevealedCount,
            ':nextRevealedCount': nextRevealedCount,
            ':updatedAt': new Date().toISOString(),
          },
        }),
      );
    } catch (error) {
      if (conditionalFailure(error)) return null;
      throw error;
    }

    if (!finished) return 'revealing';
    const current = await this.getReading(readingId);
    if (!current) return null;
    const target = current.resultEncrypted ? 'completed' : 'interpreting';
    const changed = await this.updateReading(
      readingId,
      { status: target },
      { status: 'revealing', revealedCount: nextRevealedCount },
    );
    if (changed) return target;
    const refreshed = await this.getReading(readingId);
    return refreshed && ['revealing', 'interpreting', 'completed'].includes(refreshed.status)
      ? (refreshed.status as 'revealing' | 'interpreting' | 'completed')
      : null;
  }

  async savePreparedInterpretation(
    readingId: string,
    resultEncrypted: string,
    jobVersion?: number,
  ) {
    const names: Record<string, string> = {
      '#resultEncrypted': 'resultEncrypted',
      '#updatedAt': 'updatedAt',
      '#state': 'state',
      '#interpretationStatus': 'interpretationStatus',
      '#dispatchPending': 'dispatchPending',
    };
    const values: Record<string, unknown> = {
      ':resultEncrypted': resultEncrypted,
      ':updatedAt': new Date().toISOString(),
      ':completed': 'completed',
    };
    const conditions = ['attribute_exists(pk)'];
    if (jobVersion !== undefined) {
      names['#interpretationJobVersion'] = 'interpretationJobVersion';
      values[':jobVersion'] = jobVersion;
      conditions.push('#state.#interpretationJobVersion = :jobVersion');
    }
    try {
      await this.dynamo.send(
        new UpdateCommand({
          TableName: this.options.readingsTable,
          Key: { pk: readingKey(readingId) },
          UpdateExpression:
            'SET #resultEncrypted = :resultEncrypted, #updatedAt = :updatedAt, #state.#interpretationStatus = :completed REMOVE #state.#dispatchPending',
          ConditionExpression: conditions.join(' AND '),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }),
      );
    } catch (error) {
      if (conditionalFailure(error)) return;
      throw error;
    }
    const reading = await this.getReading(readingId);
    if (
      reading &&
      reading.state.draw.length > 0 &&
      reading.state.revealedCount >= reading.state.draw.length
    ) {
      await this.updateReading(readingId, { status: 'completed' });
    }
  }

  async saveSpreadRecommendation(readingId: string, jobVersion: number, output: SpreadAgentOutput) {
    try {
      await this.dynamo.send(
        new UpdateCommand({
          TableName: this.options.readingsTable,
          Key: { pk: readingKey(readingId) },
          UpdateExpression:
            'SET #status = :nextStatus, #updatedAt = :updatedAt, #state.#clarificationQuestion = :clarificationQuestion, #state.#recommendations = :recommendations REMOVE #state.#dispatchPending',
          ConditionExpression:
            '#status = :recommending AND #state.#recommendationJobVersion = :jobVersion',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#updatedAt': 'updatedAt',
            '#state': 'state',
            '#clarificationQuestion': 'clarificationQuestion',
            '#recommendations': 'recommendations',
            '#dispatchPending': 'dispatchPending',
            '#recommendationJobVersion': 'recommendationJobVersion',
          },
          ExpressionAttributeValues: {
            ':nextStatus': output.clarificationQuestion ? 'needs_clarification' : 'awaiting_spread',
            ':updatedAt': new Date().toISOString(),
            ':clarificationQuestion': output.clarificationQuestion,
            ':recommendations': output.recommendations,
            ':recommending': 'recommending',
            ':jobVersion': jobVersion,
          },
        }),
      );
      return true;
    } catch (error) {
      if (conditionalFailure(error)) return false;
      throw error;
    }
  }

  async saveIdempotentResponse(readingId: string, key: string, response: unknown) {
    const reading = await this.getReading(readingId);
    if (!reading) return;
    try {
      await this.dynamo.send(
        new PutCommand({
          TableName: this.options.readingsTable,
          Item: {
            pk: idempotencyKey(readingId, key),
            entityType: 'idempotency',
            response,
            expiresAtEpoch: Math.floor(reading.expiresAt.getTime() / 1_000),
            expiryShard: expiryShard(reading.expiresAt),
          },
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
    }
  }

  async getIdempotentResponse(readingId: string, key: string) {
    const response = await this.dynamo.send(
      new GetCommand({
        TableName: this.options.readingsTable,
        Key: { pk: idempotencyKey(readingId, key) },
        ConsistentRead: true,
      }),
    );
    if (!response.Item || Number(response.Item.expiresAtEpoch) <= Date.now() / 1_000) return null;
    return response.Item.response ?? null;
  }

  private async enqueue(type: AgentJobType, readingId: string, version: number) {
    const message: AgentJobMessage = { type, readingId, version };
    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.options.queueUrl,
        MessageBody: JSON.stringify(message),
      }),
    );
    try {
      await this.dynamo.send(
        new UpdateCommand({
          TableName: this.options.readingsTable,
          Key: { pk: readingKey(readingId) },
          UpdateExpression: 'SET #updatedAt = :updatedAt REMOVE #state.#dispatchPending',
          ConditionExpression:
            '#state.#dispatchPending.#type = :type AND #state.#dispatchPending.#version = :version',
          ExpressionAttributeNames: {
            '#updatedAt': 'updatedAt',
            '#state': 'state',
            '#dispatchPending': 'dispatchPending',
            '#type': 'type',
            '#version': 'version',
          },
          ExpressionAttributeValues: {
            ':updatedAt': new Date().toISOString(),
            ':type': type,
            ':version': version,
          },
        }),
      );
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
    }
  }

  async enqueueRecommendation(readingId: string, jobVersion: number) {
    await this.enqueue('recommend_spread', readingId, jobVersion);
  }

  async enqueueInterpretation(_id: string, readingId: string, jobVersion?: number) {
    const reading = await this.getReading(readingId);
    const version = jobVersion ?? reading?.state.interpretationJobVersion ?? 1;
    await this.enqueue('interpret_reading', readingId, version);
  }

  async claimAgentJob(type: AgentJobType, readingId: string, version: number) {
    const now = Math.floor(Date.now() / 1_000);
    const expiresAt = new Date((now + 25 * 60 * 60) * 1_000);
    try {
      await this.dynamo.send(
        new PutCommand({
          TableName: this.options.readingsTable,
          Item: {
            pk: agentJobKey(type, readingId, version),
            entityType: 'agentJob',
            type,
            readingId,
            version,
            status: 'processing',
            leaseUntil: now + 5 * 60,
            expiresAtEpoch: Math.floor(expiresAt.getTime() / 1_000),
            expiryShard: expiryShard(expiresAt),
          },
          ConditionExpression:
            'attribute_not_exists(pk) OR (#status = :processing AND leaseUntil < :now)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':processing': 'processing', ':now': now },
        }),
      );
      return true;
    } catch (error) {
      if (conditionalFailure(error)) return false;
      throw error;
    }
  }

  async completeAgentJob(type: AgentJobType, readingId: string, version: number) {
    try {
      await this.dynamo.send(
        new UpdateCommand({
          TableName: this.options.readingsTable,
          Key: { pk: agentJobKey(type, readingId, version) },
          UpdateExpression: 'SET #status = :completed, #completedAt = :completedAt',
          ConditionExpression: '#status = :processing',
          ExpressionAttributeNames: { '#status': 'status', '#completedAt': 'completedAt' },
          ExpressionAttributeValues: {
            ':processing': 'processing',
            ':completed': 'completed',
            ':completedAt': new Date().toISOString(),
          },
        }),
      );
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
    }
  }

  async restartInterpretation(readingId: string) {
    const reading = await this.getReading(readingId);
    if (!reading) return;
    const version = (reading.state.interpretationJobVersion ?? 0) + 1;
    await this.updateReading(readingId, {
      status: 'interpreting',
      resultEncrypted: null,
      state: {
        ...reading.state,
        interpretationJobVersion: version,
        interpretationStatus: 'pending',
        dispatchPending: { type: 'interpret_reading', version },
      },
    });
    await this.enqueueInterpretation(randomUUID(), readingId, version);
  }

  async consumeRateLimit(bucketKey: string, limit: number) {
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setUTCMinutes(0, 0, 0);
    const pk = `${bucketKey}#${windowStart.toISOString()}`;
    const response = await this.dynamo.send(
      new UpdateCommand({
        TableName: this.options.rateLimitsTable,
        Key: { bucketKey: pk },
        UpdateExpression: 'ADD #count :one SET expiresAtEpoch = :expiresAtEpoch',
        ExpressionAttributeNames: { '#count': 'count' },
        ExpressionAttributeValues: {
          ':one': 1,
          ':expiresAtEpoch': Math.floor(windowStart.getTime() / 1_000) + 2 * 60 * 60,
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    const count = Number(response.Attributes?.count ?? limit + 1);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  }

  async recoverPendingDispatches() {
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const response = await this.dynamo.send(
        new ScanCommand({
          TableName: this.options.readingsTable,
          FilterExpression:
            'entityType = :reading AND expiresAtEpoch > :now AND attribute_exists(#state.#dispatchPending)',
          ExpressionAttributeNames: { '#state': 'state', '#dispatchPending': 'dispatchPending' },
          ExpressionAttributeValues: {
            ':reading': 'reading',
            ':now': Math.floor(Date.now() / 1_000),
          },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      for (const item of response.Items ?? []) {
        const reading = fromReadingItem(item);
        const pending = reading.state.dispatchPending;
        if (pending) await this.enqueue(pending.type, reading.id, pending.version);
      }
      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);
  }

  async cleanupExpired() {
    const now = new Date();
    const shards = [0, 1].map((daysAgo) => {
      const date = new Date(now);
      date.setUTCDate(date.getUTCDate() - daysAgo);
      return expiryShard(date);
    });
    for (const shard of shards) {
      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const response = await this.dynamo.send(
          new QueryCommand({
            TableName: this.options.readingsTable,
            IndexName: 'expiry-shard-index',
            ProjectionExpression: 'pk',
            KeyConditionExpression: 'expiryShard = :shard AND expiresAtEpoch <= :now',
            ExpressionAttributeValues: {
              ':shard': shard,
              ':now': Math.floor(now.getTime() / 1_000),
            },
            ExclusiveStartKey: exclusiveStartKey,
          }),
        );
        const items = response.Items ?? [];
        for (let index = 0; index < items.length; index += 25) {
          let pending = items.slice(index, index + 25).map((item) => ({
            DeleteRequest: { Key: { pk: item.pk } },
          }));
          for (let attempt = 0; pending.length > 0 && attempt < 4; attempt += 1) {
            const batch = await this.dynamo.send(
              new BatchWriteCommand({
                RequestItems: { [this.options.readingsTable]: pending },
              }),
            );
            pending = (batch.UnprocessedItems?.[this.options.readingsTable] ?? []).flatMap(
              (item) =>
                item.DeleteRequest?.Key?.pk
                  ? [{ DeleteRequest: { Key: { pk: item.DeleteRequest.Key.pk } } }]
                  : [],
            );
          }
          if (pending.length > 0) throw new Error('DynamoDB cleanup left unprocessed deletes.');
        }
        exclusiveStartKey = response.LastEvaluatedKey;
      } while (exclusiveStartKey);
    }
  }
}
