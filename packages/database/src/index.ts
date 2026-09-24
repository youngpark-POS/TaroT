import type { ReadingStatus, Spread, SpreadAgentOutput, TarotCard } from '@tarot/contracts';
import { and, eq, gt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { DynamoTarotRepository } from './dynamo.js';
import { cards, idempotencyKeys, interpretationJobs, readings, spreads } from './schema.js';

export * from './schema.js';
export * from './dynamo.js';

export interface StoredReadingState {
  highRisk: boolean;
  crisis: boolean;
  clarificationQuestion: string | null;
  clarificationUsed: boolean;
  recommendations: Array<{ spreadId: string; reason: string }>;
  selectedSpreadId: string | null;
  draw: Array<{ positionIndex: number; cardId: string; orientation: 'upright' | 'reversed' }>;
  revealedCount: number;
  recommendationJobVersion?: number;
  interpretationJobVersion?: number;
  interpretationStatus?: 'idle' | 'pending' | 'running' | 'completed' | 'failed';
  dispatchPending?: { type: 'recommend_spread' | 'interpret_reading'; version: number } | null;
}

export interface StoredReading {
  id: string;
  sessionHash: string;
  status: ReadingStatus;
  questionEncrypted: string;
  clarificationEncrypted: string | null;
  resultEncrypted: string | null;
  state: StoredReadingState;
  contentVersion: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReadingUpdateCondition {
  status?: ReadingStatus;
  revealedCount?: number;
}

export interface TarotRepositoryPort {
  readonly asyncAgents: boolean;
  close(): Promise<void>;
  isReady(): Promise<unknown>;
  listCards(): Promise<TarotCard[]>;
  listSpreads(): Promise<Spread[]>;
  getCard(id: string): Promise<TarotCard | null>;
  getSpread(id: string): Promise<Spread | null>;
  createReading(reading: StoredReading): Promise<void>;
  getReading(id: string, sessionHash?: string): Promise<StoredReading | null>;
  updateReading(
    id: string,
    values: Partial<
      Pick<StoredReading, 'status' | 'state' | 'clarificationEncrypted' | 'resultEncrypted'>
    >,
    condition?: ReadingUpdateCondition,
  ): Promise<boolean>;
  advanceReveal(
    readingId: string,
    expectedRevealedCount: number,
    nextRevealedCount: number,
    finished: boolean,
  ): Promise<'revealing' | 'interpreting' | 'completed' | null>;
  savePreparedInterpretation(
    readingId: string,
    resultEncrypted: string,
    jobVersion?: number,
  ): Promise<void>;
  saveSpreadRecommendation(
    readingId: string,
    jobVersion: number,
    output: SpreadAgentOutput,
  ): Promise<boolean>;
  saveIdempotentResponse(readingId: string, key: string, response: unknown): Promise<void>;
  getIdempotentResponse(readingId: string, key: string): Promise<unknown | null>;
  enqueueRecommendation(readingId: string, jobVersion: number): Promise<void>;
  enqueueInterpretation(id: string, readingId: string, jobVersion?: number): Promise<void>;
  claimAgentJob(
    type: 'recommend_spread' | 'interpret_reading',
    readingId: string,
    version: number,
  ): Promise<boolean>;
  completeAgentJob(
    type: 'recommend_spread' | 'interpret_reading',
    readingId: string,
    version: number,
  ): Promise<void>;
  restartInterpretation(readingId: string): Promise<void>;
  consumeRateLimit(
    bucketKey: string,
    limit: number,
  ): Promise<{ allowed: boolean; remaining: number }>;
  cleanupExpired(): Promise<void>;
}

export function createTarotRepository(config: {
  STORAGE_DRIVER: 'postgres' | 'dynamodb';
  DATABASE_URL: string;
  READINGS_TABLE: string;
  CONTENT_TABLE: string;
  RATE_LIMITS_TABLE: string;
  AGENT_QUEUE_URL: string | undefined;
  contentVersion: string;
}): TarotRepositoryPort {
  if (config.STORAGE_DRIVER === 'dynamodb') {
    if (!config.AGENT_QUEUE_URL) throw new Error('AGENT_QUEUE_URL is required for DynamoDB mode.');
    return new DynamoTarotRepository({
      readingsTable: config.READINGS_TABLE,
      contentTable: config.CONTENT_TABLE,
      rateLimitsTable: config.RATE_LIMITS_TABLE,
      queueUrl: config.AGENT_QUEUE_URL,
      contentVersion: config.contentVersion,
    });
  }
  return new TarotRepository(config.DATABASE_URL);
}

export class TarotRepository implements TarotRepositoryPort {
  readonly asyncAgents = false;
  readonly pool: pg.Pool;
  readonly db;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    this.db = drizzle(this.pool);
  }

  async close() {
    await this.pool.end();
  }

  async isReady() {
    await this.pool.query('select 1');
  }

  async listCards(): Promise<TarotCard[]> {
    return (await this.db.select({ data: cards.data }).from(cards)).map(
      (row) => row.data as TarotCard,
    );
  }

  async listSpreads(): Promise<Spread[]> {
    return (await this.db.select({ data: spreads.data }).from(spreads)).map(
      (row) => row.data as Spread,
    );
  }

  async getCard(id: string): Promise<TarotCard | null> {
    const [row] = await this.db.select({ data: cards.data }).from(cards).where(eq(cards.id, id));
    return (row?.data as TarotCard | undefined) ?? null;
  }

  async getSpread(id: string): Promise<Spread | null> {
    const [row] = await this.db
      .select({ data: spreads.data })
      .from(spreads)
      .where(eq(spreads.id, id));
    return (row?.data as Spread | undefined) ?? null;
  }

  async createReading(reading: StoredReading) {
    await this.db.insert(readings).values(reading);
  }

  async getReading(id: string, sessionHash?: string): Promise<StoredReading | null> {
    const where = sessionHash
      ? and(
          eq(readings.id, id),
          eq(readings.sessionHash, sessionHash),
          gt(readings.expiresAt, new Date()),
        )
      : and(eq(readings.id, id), gt(readings.expiresAt, new Date()));
    const [row] = await this.db.select().from(readings).where(where);
    return (row as StoredReading | undefined) ?? null;
  }

  async updateReading(
    id: string,
    values: Partial<
      Pick<StoredReading, 'status' | 'state' | 'clarificationEncrypted' | 'resultEncrypted'>
    >,
    condition?: ReadingUpdateCondition,
  ) {
    const filters = [eq(readings.id, id)];
    if (condition?.status) filters.push(eq(readings.status, condition.status));
    if (condition?.revealedCount !== undefined) {
      filters.push(sql`(state->>'revealedCount')::int = ${condition.revealedCount}`);
    }
    const rows = await this.db
      .update(readings)
      .set({ ...values, updatedAt: new Date() })
      .where(and(...filters))
      .returning({ id: readings.id });
    return rows.length > 0;
  }

  async advanceReveal(
    readingId: string,
    expectedRevealedCount: number,
    nextRevealedCount: number,
    finished: boolean,
  ) {
    const result = await this.pool.query<{ status: 'revealing' | 'interpreting' | 'completed' }>(
      `UPDATE readings
       SET state = jsonb_set(state, '{revealedCount}', to_jsonb($3::int), false),
           status = CASE
             WHEN $4::boolean THEN
               CASE WHEN result_encrypted IS NOT NULL THEN 'completed' ELSE 'interpreting' END
             ELSE 'revealing'
           END,
           updated_at = now()
       WHERE id = $1
         AND status = 'revealing'
         AND (state->>'revealedCount')::int = $2
       RETURNING status`,
      [readingId, expectedRevealedCount, nextRevealedCount, finished],
    );
    return result.rows[0]?.status ?? null;
  }

  async savePreparedInterpretation(
    readingId: string,
    resultEncrypted: string,
    _jobVersion?: number,
  ) {
    await this.pool.query(
      `UPDATE readings
       SET result_encrypted = $2,
           status = CASE
             WHEN jsonb_array_length(state->'draw') > 0
              AND (state->>'revealedCount')::int >= jsonb_array_length(state->'draw')
             THEN 'completed'
             ELSE status
           END,
           updated_at = now()
       WHERE id = $1`,
      [readingId, resultEncrypted],
    );
  }

  async saveSpreadRecommendation(
    readingId: string,
    _jobVersion: number,
    output: SpreadAgentOutput,
  ) {
    const reading = await this.getReading(readingId);
    if (!reading) return false;
    const state = {
      ...reading.state,
      clarificationQuestion: output.clarificationQuestion,
      recommendations: output.recommendations,
      dispatchPending: null,
    };
    return this.updateReading(readingId, {
      state,
      status: output.clarificationQuestion ? 'needs_clarification' : 'awaiting_spread',
    });
  }

  async saveIdempotentResponse(readingId: string, key: string, response: unknown) {
    await this.db
      .insert(idempotencyKeys)
      .values({ readingId, key, response })
      .onConflictDoNothing();
  }

  async getIdempotentResponse(readingId: string, key: string): Promise<unknown | null> {
    const [row] = await this.db
      .select({ response: idempotencyKeys.response })
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.readingId, readingId), eq(idempotencyKeys.key, key)));
    return row?.response ?? null;
  }

  async enqueueRecommendation(_readingId: string, _jobVersion: number) {
    throw new Error('PostgreSQL mode performs spread recommendation synchronously.');
  }

  async enqueueInterpretation(id: string, readingId: string, _jobVersion?: number) {
    await this.db.insert(interpretationJobs).values({ id, readingId }).onConflictDoNothing();
  }

  async claimAgentJob() {
    return true;
  }

  async completeAgentJob() {}

  async restartInterpretation(readingId: string) {
    await this.db
      .update(interpretationJobs)
      .set({ status: 'pending', attempts: 0, availableAt: new Date(), lockedAt: null, error: null })
      .where(eq(interpretationJobs.readingId, readingId));
  }

  async recoverStaleJobs() {
    await this.pool.query(
      `UPDATE interpretation_jobs
       SET status = 'retry', locked_at = NULL, available_at = now()
       WHERE status = 'running' AND locked_at < now() - interval '5 minutes'`,
    );
  }

  async claimJob(): Promise<{ id: string; readingId: string; attempts: number } | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string; reading_id: string; attempts: number }>(`
        SELECT id, reading_id, attempts
        FROM interpretation_jobs
        WHERE status IN ('pending', 'retry') AND available_at <= now()
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      const job = result.rows[0];
      if (!job) {
        await client.query('COMMIT');
        return null;
      }
      await client.query(
        "UPDATE interpretation_jobs SET status = 'running', locked_at = now(), attempts = attempts + 1 WHERE id = $1",
        [job.id],
      );
      await client.query('COMMIT');
      return { id: job.id, readingId: job.reading_id, attempts: job.attempts + 1 };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async completeJob(id: string) {
    await this.db
      .update(interpretationJobs)
      .set({ status: 'completed' })
      .where(eq(interpretationJobs.id, id));
  }

  async retryOrFailJob(id: string, error: string, attempts: number) {
    const failed = attempts >= 3;
    await this.db
      .update(interpretationJobs)
      .set({
        status: failed ? 'failed' : 'retry',
        error: error.slice(0, 1000),
        availableAt: new Date(Date.now() + attempts * 2_000),
      })
      .where(eq(interpretationJobs.id, id));
    return failed;
  }

  async consumeRateLimit(
    bucketKey: string,
    limit: number,
  ): Promise<{ allowed: boolean; remaining: number }> {
    const windowStart = new Date();
    windowStart.setMinutes(0, 0, 0);
    const result = await this.pool.query<{ count: number }>(
      `INSERT INTO rate_limits (bucket_key, window_start, count)
       VALUES ($1, $2, 1)
       ON CONFLICT (bucket_key, window_start)
       DO UPDATE SET count = rate_limits.count + 1
       RETURNING count`,
      [bucketKey, windowStart],
    );
    const count = result.rows[0]?.count ?? limit + 1;
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  }

  async cleanupExpired() {
    await this.db.delete(readings).where(sql`${readings.expiresAt} <= now()`);
    await this.pool.query(
      "DELETE FROM rate_limits WHERE window_start < now() - interval '2 hours'",
    );
  }
}
