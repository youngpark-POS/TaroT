import type { ReadingStatus, Spread, TarotCard } from '@tarot/contracts';
import { and, eq, gt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { cards, idempotencyKeys, interpretationJobs, readings, spreads } from './schema.js';

export * from './schema.js';

export interface StoredReadingState {
  highRisk: boolean;
  crisis: boolean;
  clarificationQuestion: string | null;
  clarificationUsed: boolean;
  recommendations: Array<{ spreadId: string; reason: string }>;
  selectedSpreadId: string | null;
  draw: Array<{ positionIndex: number; cardId: string; orientation: 'upright' | 'reversed' }>;
  revealedCount: number;
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

export class TarotRepository {
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
  ) {
    await this.db
      .update(readings)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(readings.id, id));
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

  async enqueueInterpretation(id: string, readingId: string) {
    await this.db.insert(interpretationJobs).values({ id, readingId }).onConflictDoNothing();
  }

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
