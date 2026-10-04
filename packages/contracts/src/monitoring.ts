import { z } from 'zod';

export const usageTotalsSchema = z.object({
  runs: z.number().nonnegative(),
  failures: z.number().nonnegative(),
  requests: z.number().nonnegative(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  totalTokens: z.number().nonnegative(),
  unreportedRuns: z.number().nonnegative(),
});
export const monitoringSnapshotSchema = z.object({
  generatedAt: z.string().datetime(),
  rangeDays: z.number().int(),
  region: z.string(),
  service: z.object({ live: z.boolean(), ready: z.boolean(), latencyMs: z.number() }),
  functions: z.array(
    z.object({
      name: z.string(),
      role: z.string(),
      invocations: z.number(),
      errors: z.number(),
      throttles: z.number(),
      durationP95Ms: z.number().nullable(),
    }),
  ),
  queues: z.array(
    z.object({
      name: z.string(),
      deadLetter: z.boolean(),
      visible: z.number(),
      inFlight: z.number(),
      delayed: z.number(),
      oldestAgeSeconds: z.number().nullable(),
    }),
  ),
  alarms: z.array(
    z.object({ name: z.string(), state: z.string(), updatedAt: z.string().nullable() }),
  ),
  usage: z.object({
    totals: usageTotalsSchema,
    byAgent: z.array(z.object({ role: z.string(), model: z.string(), totals: usageTotalsSchema })),
    daily: z.array(z.object({ day: z.string(), totals: usageTotalsSchema })),
    retentionDays: z.number(),
  }),
  warnings: z.array(z.string()),
});
export type UsageTotals = z.infer<typeof usageTotalsSchema>;
export type MonitoringSnapshot = z.infer<typeof monitoringSnapshotSchema>;
