import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const contentVersions = pgTable('content_versions', {
  version: varchar('version', { length: 64 }).primaryKey(),
  seededAt: timestamp('seeded_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cards = pgTable('cards', {
  id: varchar('id', { length: 80 }).primaryKey(),
  contentVersion: varchar('content_version', { length: 64 }).notNull(),
  data: jsonb('data').notNull(),
});

export const spreads = pgTable('spreads', {
  id: varchar('id', { length: 80 }).primaryKey(),
  contentVersion: varchar('content_version', { length: 64 }).notNull(),
  data: jsonb('data').notNull(),
});

export const readings = pgTable(
  'readings',
  {
    id: uuid('id').primaryKey(),
    sessionHash: varchar('session_hash', { length: 64 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    questionEncrypted: text('question_encrypted').notNull(),
    clarificationEncrypted: text('clarification_encrypted'),
    resultEncrypted: text('result_encrypted'),
    state: jsonb('state').notNull(),
    contentVersion: varchar('content_version', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('readings_session_idx').on(table.sessionHash),
    index('readings_expiry_idx').on(table.expiresAt),
  ],
);

export const interpretationJobs = pgTable(
  'interpretation_jobs',
  {
    id: uuid('id').primaryKey(),
    readingId: uuid('reading_id').notNull().unique(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('jobs_poll_idx').on(table.status, table.availableAt)],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    readingId: uuid('reading_id').notNull(),
    key: varchar('key', { length: 128 }).notNull(),
    response: jsonb('response').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.readingId, table.key] })],
);

export const rateLimits = pgTable(
  'rate_limits',
  {
    bucketKey: varchar('bucket_key', { length: 64 }).notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.bucketKey, table.windowStart] })],
);
