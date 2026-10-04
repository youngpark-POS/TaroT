import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  TransactWriteCommand,
  type QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import {
  CloudWatchClient,
  DescribeAlarmsCommand,
  GetMetricDataCommand,
  type MetricDataQuery,
} from '@aws-sdk/client-cloudwatch';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { MonitoringSnapshot, UsageTotals } from '@tarot/contracts/monitoring';

export interface AgentUsageEvent {
  id: string;
  role: 'spread' | 'reading';
  model: string;
  succeeded: boolean;
  reported: boolean;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export const emptyTotals = (): UsageTotals => ({
  runs: 0,
  failures: 0,
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  unreportedRuns: 0,
});
export function sumTotals(rows: UsageTotals[]): UsageTotals {
  return rows.reduce((sum, row) => {
    for (const key of Object.keys(sum) as Array<keyof UsageTotals>) sum[key] += row[key] ?? 0;
    return sum;
  }, emptyTotals());
}

export function usageTransaction(table: string, event: AgentUsageEvent, now = new Date()) {
  const expiresAtEpoch = Math.floor(now.getTime() / 1000) + 90 * 86400;
  return new TransactWriteCommand({
    TransactItems: [
      {
        Put: {
          TableName: table,
          Item: { pk: `EVENT#${event.id}`, sk: 'DEDUPE', expiresAtEpoch },
          ConditionExpression: 'attribute_not_exists(pk)',
        },
      },
      {
        Update: {
          TableName: table,
          Key: {
            pk: `DAY#${now.toISOString().slice(0, 10)}`,
            sk: `AGENT#${event.role}#${event.model}`,
          },
          UpdateExpression:
            'SET #role = :role, #model = :model, expiresAtEpoch = :expiry ADD runs :one, failures :failure, requests :requests, inputTokens :input, outputTokens :output, totalTokens :total, unreportedRuns :unreported',
          ExpressionAttributeNames: { '#role': 'role', '#model': 'model' },
          ExpressionAttributeValues: {
            ':role': event.role,
            ':model': event.model,
            ':expiry': expiresAtEpoch,
            ':one': 1,
            ':failure': event.succeeded ? 0 : 1,
            ':requests': event.requests,
            ':input': event.inputTokens,
            ':output': event.outputTokens,
            ':total': event.totalTokens,
            ':unreported': event.reported ? 0 : 1,
          },
        },
      },
    ],
  });
}

export function createUsageObserver(table: string | undefined, region: string) {
  if (!table) return undefined;
  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region, maxAttempts: 2, requestHandler: { requestTimeout: 2500 } }),
  );
  return async (event: AgentUsageEvent) => {
    try {
      await client.send(usageTransaction(table, event));
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'TransactionCanceledException' &&
        (error as Error & { CancellationReasons?: Array<{ Code?: string }> })
          .CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed'
      )
        return;
      // Telemetry must never cause another paid agent run. No prompt/response/error text is logged.
      console.warn(
        JSON.stringify({ event: 'telemetry_write_failed', errorType: 'TelemetryWriteError' }),
      );
    }
  };
}

export async function readUsage(table: string, region: string, days: number, now = new Date()) {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  const byAgent = new Map<string, { role: string; model: string; totals: UsageTotals }>();
  const daily: MonitoringSnapshot['usage']['daily'] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = new Date(now.getTime() - offset * 86400000).toISOString().slice(0, 10);
    const rows: UsageTotals[] = [];
    let cursor: QueryCommandOutput['LastEvaluatedKey'];
    do {
      const page = await client.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': `DAY#${day}` },
          ExclusiveStartKey: cursor,
        }),
      );
      for (const item of page.Items ?? []) {
        const totals = Object.fromEntries(
          Object.keys(emptyTotals()).map((key) => [key, Number(item[key] ?? 0)]),
        ) as UsageTotals;
        rows.push(totals);
        const key = `${item.role}:${item.model}`;
        const previous = byAgent.get(key);
        byAgent.set(key, {
          role: String(item.role),
          model: String(item.model),
          totals: sumTotals([previous?.totals ?? emptyTotals(), totals]),
        });
      }
      cursor = page.LastEvaluatedKey;
    } while (cursor);
    daily.push({ day, totals: sumTotals(rows) });
  }
  return {
    totals: sumTotals(daily.map((row) => row.totals)),
    byAgent: [...byAgent.values()],
    daily,
    retentionDays: 90,
  };
}

export function createAdminVerifier(
  region: string,
  poolId: string,
  clientId: string,
  testKeySet?: JWTVerifyGetKey,
) {
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${poolId}`;
  const jwks = testKeySet ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (token: string) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: clientId,
      algorithms: ['RS256'],
    });
    assertAdminClaims(payload);
  };
}
export function assertAdminClaims(payload: Record<string, unknown>) {
  if (
    payload.token_use !== 'id' ||
    !Array.isArray(payload['cognito:groups']) ||
    !payload['cognito:groups'].includes('monitoring-admins')
  )
    throw new Error('Administrator membership required.');
}

export async function awsSnapshot(
  config: {
    region: string;
    prefix: string;
    telemetryTable: string;
    queueUrl: string;
    dlqUrl: string;
  },
  days: number,
  checkHealth: () => Promise<MonitoringSnapshot['service']>,
): Promise<MonitoringSnapshot> {
  const cloudwatch = new CloudWatchClient({ region: config.region });
  const sqs = new SQSClient({ region: config.region });
  const now = new Date();
  // Infrastructure metrics cover the latest hour; token totals use the selected UTC day range.
  const start = new Date(now.getTime() - 3600000);
  const queries: MetricDataQuery[] = [];
  for (const role of ['api', 'worker', 'cleanup']) {
    for (const [metric, stat] of [
      ['Invocations', 'Sum'],
      ['Errors', 'Sum'],
      ['Throttles', 'Sum'],
      ['Duration', 'p95'],
    ] as const) {
      queries.push({
        Id: `${role}_${metric.toLowerCase()}`,
        MetricStat: {
          Metric: {
            Namespace: 'AWS/Lambda',
            MetricName: metric,
            Dimensions: [{ Name: 'FunctionName', Value: `${config.prefix}-${role}` }],
          },
          Period: 300,
          Stat: stat,
        },
        ReturnData: true,
      });
    }
  }
  for (const suffix of ['agent-jobs', 'agent-jobs-dlq'])
    queries.push({
      Id: suffix.endsWith('dlq') ? 'dlq_age' : 'queue_age',
      MetricStat: {
        Metric: {
          Namespace: 'AWS/SQS',
          MetricName: 'ApproximateAgeOfOldestMessage',
          Dimensions: [{ Name: 'QueueName', Value: `${config.prefix}-${suffix}` }],
        },
        Period: 300,
        Stat: 'Maximum',
      },
      ReturnData: true,
    });
  const results = await Promise.allSettled([
    cloudwatch.send(
      new GetMetricDataCommand({
        StartTime: start,
        EndTime: now,
        MetricDataQueries: queries,
        ScanBy: 'TimestampDescending',
      }),
    ),
    cloudwatch.send(
      new DescribeAlarmsCommand({ AlarmNamePrefix: `${config.prefix}-`, MaxRecords: 100 }),
    ),
    sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: config.queueUrl,
        AttributeNames: [
          'ApproximateNumberOfMessages',
          'ApproximateNumberOfMessagesNotVisible',
          'ApproximateNumberOfMessagesDelayed',
        ],
      }),
    ),
    sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: config.dlqUrl,
        AttributeNames: [
          'ApproximateNumberOfMessages',
          'ApproximateNumberOfMessagesNotVisible',
          'ApproximateNumberOfMessagesDelayed',
        ],
      }),
    ),
    readUsage(config.telemetryTable, config.region, days, now),
    checkHealth(),
  ] as const);
  // Do not turn unavailable sources into zeroes or a green status.
  if (results.some((result) => result.status === 'rejected'))
    throw new Error('Monitoring data source unavailable.');
  const metrics = results[0].status === 'fulfilled' ? results[0].value : undefined;
  if (
    !metrics?.MetricDataResults ||
    metrics.MetricDataResults.length !== queries.length ||
    metrics.MetricDataResults.some((row) => row.StatusCode !== 'Complete')
  ) {
    throw new Error('CloudWatch metrics are incomplete.');
  }
  const values = new Map(metrics?.MetricDataResults?.map((row) => [row.Id, row.Values ?? []]));
  const metric = (id: string) => values.get(id)?.[0] ?? null;
  const totalMetric = (id: string) => (values.get(id) ?? []).reduce((sum, value) => sum + value, 0);
  const alarms = results[1].status === 'fulfilled' ? (results[1].value.MetricAlarms ?? []) : [];
  const usage =
    results[4].status === 'fulfilled'
      ? results[4].value
      : { totals: emptyTotals(), byAgent: [], daily: [], retentionDays: 90 };
  const service =
    results[5].status === 'fulfilled'
      ? results[5].value
      : { live: false, ready: false, latencyMs: 0 };
  return {
    generatedAt: now.toISOString(),
    rangeDays: days,
    region: config.region,
    service,
    functions: ['api', 'worker', 'cleanup'].map((role) => ({
      name: `${config.prefix}-${role}`,
      role,
      invocations: totalMetric(`${role}_invocations`),
      errors: totalMetric(`${role}_errors`),
      throttles: totalMetric(`${role}_throttles`),
      durationP95Ms: metric(`${role}_duration`),
    })),
    queues: [2, 3].map((index) => {
      const result = results[index]!;
      const attributes =
        result.status === 'fulfilled' && 'Attributes' in result.value
          ? (result.value.Attributes ?? {})
          : {};
      const deadLetter = index === 3;
      return {
        name: `${config.prefix}-agent-jobs${deadLetter ? '-dlq' : ''}`,
        deadLetter,
        visible: Number(attributes.ApproximateNumberOfMessages ?? 0),
        inFlight: Number(attributes.ApproximateNumberOfMessagesNotVisible ?? 0),
        delayed: Number(attributes.ApproximateNumberOfMessagesDelayed ?? 0),
        oldestAgeSeconds: metric(deadLetter ? 'dlq_age' : 'queue_age'),
      };
    }),
    alarms: alarms.map((alarm) => ({
      name: alarm.AlarmName ?? '',
      state: alarm.StateValue ?? 'INSUFFICIENT_DATA',
      updatedAt: alarm.StateUpdatedTimestamp?.toISOString() ?? null,
    })),
    usage,
    warnings: [
      ...(usage.totals.unreportedRuns > 0
        ? ['일부 실패 호출은 제공자 사용량을 반환하지 않아 토큰 합계에 포함되지 않았습니다.']
        : []),
    ],
  };
}
