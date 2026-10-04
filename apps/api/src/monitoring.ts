import { randomBytes, createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { awsSnapshot, createAdminVerifier } from '@tarot/monitoring';
import { monitoringSnapshotSchema, type MonitoringSnapshot } from '@tarot/contracts/monitoring';
import { decrypt, encrypt, type AppConfig } from '@tarot/runtime';
import { z } from 'zod';

const SESSION = 'tarot_monitoring';
const FLOW = 'tarot_monitoring_oauth';
const monitoringProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string(),
});

export async function registerMonitoring(
  app: FastifyInstance,
  config: AppConfig,
  overrides?: {
    verify?: (token: string) => Promise<void>;
    snapshot?: (days: number) => Promise<MonitoringSnapshot>;
  },
) {
  const enabled = Boolean(
    config.MONITORING_USER_POOL_ID &&
    config.MONITORING_CLIENT_ID &&
    config.MONITORING_AUTH_DOMAIN &&
    config.MONITORING_SITE_ORIGIN &&
    config.TELEMETRY_TABLE &&
    config.AGENT_QUEUE_URL &&
    config.MONITORING_DLQ_URL,
  );
  const verify =
    overrides?.verify ??
    (enabled
      ? createAdminVerifier(
          config.AWS_REGION,
          config.MONITORING_USER_POOL_ID!,
          config.MONITORING_CLIENT_ID!,
        )
      : undefined);
  const callback = `${config.MONITORING_SITE_ORIGIN}/v1/monitoring/callback`;
  const cookieOptions = {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
  const cache = new Map<number, { time: number; snapshot: MonitoringSnapshot }>();
  await app.register(async (scope) => {
    scope.addHook('onSend', async (_request, reply, payload) => {
      reply.header('Cache-Control', 'private, no-store');
      reply.header('Referrer-Policy', 'no-referrer');
      return payload;
    });
    scope.get('/v1/monitoring/config', async () => ({ enabled }));
    scope.get('/v1/monitoring/login', async (_request, reply) => {
      if (!enabled) return reply.code(503).send({ error: 'Monitoring is not configured.' });
      const state = randomBytes(32).toString('base64url');
      const verifier = randomBytes(32).toString('base64url');
      reply.setCookie(
        FLOW,
        encrypt({ state, verifier, createdAt: Date.now() }, config.DATA_ENCRYPTION_KEY),
        { ...cookieOptions, maxAge: 300 },
      );
      const url = new URL('/oauth2/authorize', config.MONITORING_AUTH_DOMAIN);
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: config.MONITORING_CLIENT_ID!,
        redirect_uri: callback,
        scope: 'openid email',
        state,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      }).toString();
      return reply.redirect(url.toString());
    });
    scope.get('/v1/monitoring/callback', async (request, reply) => {
      reply.clearCookie(FLOW, cookieOptions);
      if (!enabled) return reply.code(503).send({ error: 'Monitoring is not configured.' });
      try {
        const query = z
          .object({ code: z.string().min(1).max(4096), state: z.string().min(1).max(128) })
          .parse(request.query);
        const flow = decrypt<{ state: string; verifier: string; createdAt: number }>(
          request.cookies[FLOW] ?? '',
          config.DATA_ENCRYPTION_KEY,
        );
        if (
          flow.state !== query.state ||
          Date.now() - flow.createdAt > 300000 ||
          flow.createdAt > Date.now()
        )
          throw new Error('Invalid OAuth state.');
        const response = await fetch(new URL('/oauth2/token', config.MONITORING_AUTH_DOMAIN), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: config.MONITORING_CLIENT_ID!,
            redirect_uri: callback,
            code: query.code,
            code_verifier: flow.verifier,
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error('Token exchange failed.');
        const tokens = z.object({ id_token: z.string().max(12000) }).parse(await response.json());
        await verify!(tokens.id_token);
        reply.setCookie(SESSION, tokens.id_token, { ...cookieOptions, maxAge: 900 });
        return reply.redirect(`${config.MONITORING_SITE_ORIGIN}/monitoring`);
      } catch {
        reply.clearCookie(SESSION, cookieOptions);
        return reply.redirect(`${config.MONITORING_SITE_ORIGIN}/monitoring?auth=failed`);
      }
    });
    scope.get('/v1/monitoring/logout', async (_request, reply) => {
      reply.clearCookie(SESSION, cookieOptions);
      if (!enabled) return reply.redirect('/monitoring');
      const url = new URL('/logout', config.MONITORING_AUTH_DOMAIN);
      url.search = new URLSearchParams({
        client_id: config.MONITORING_CLIENT_ID!,
        logout_uri: `${config.MONITORING_SITE_ORIGIN}/monitoring`,
      }).toString();
      return reply.redirect(url.toString());
    });
    scope.get(
      '/v1/monitoring/snapshot',
      {
        schema: {
          querystring: z.object({
            days: z.coerce
              .number()
              .refine((value) => [1, 7, 30].includes(value))
              .default(7),
          }),
          response: {
            200: monitoringSnapshotSchema,
            401: monitoringProblemSchema,
            503: monitoringProblemSchema,
          },
        },
      },
      async (request, reply) => {
        if (!enabled)
          return reply.code(503).type('application/problem+json').send({
            type: 'about:blank',
            title: 'Not Configured',
            status: 503,
            detail: 'Monitoring is not configured.',
          });
        try {
          await verify!(request.cookies[SESSION] ?? '');
        } catch {
          return reply.code(401).type('application/problem+json').send({
            type: 'about:blank',
            title: 'Unauthorized',
            status: 401,
            detail: 'Administrator login required.',
          });
        }
        const { days } = request.query as { days: number };
        const cached = cache.get(days);
        if (cached && Date.now() - cached.time < 60000) return cached.snapshot;
        try {
          const snapshot = overrides?.snapshot
            ? await overrides.snapshot(days)
            : await awsSnapshot(
                {
                  region: config.AWS_REGION,
                  prefix: config.MONITORING_FUNCTION_PREFIX,
                  telemetryTable: config.TELEMETRY_TABLE!,
                  queueUrl: config.AGENT_QUEUE_URL!,
                  dlqUrl: config.MONITORING_DLQ_URL!,
                },
                days,
                async () => {
                  const start = performance.now();
                  const probes = await Promise.allSettled(
                    ['/health/live', '/health/ready'].map((path) =>
                      fetch(`${config.MONITORING_SITE_ORIGIN}${path}`, {
                        signal: AbortSignal.timeout(4000),
                      }).then((response) => response.ok),
                    ),
                  );
                  return {
                    live: probes[0]?.status === 'fulfilled' && probes[0].value,
                    ready: probes[1]?.status === 'fulfilled' && probes[1].value,
                    latencyMs: Math.round(performance.now() - start),
                  };
                },
              );
          const validated = monitoringSnapshotSchema.parse(snapshot);
          cache.set(days, { time: Date.now(), snapshot: validated });
          return validated;
        } catch {
          request.log.warn({ event: 'monitoring_source_unavailable' });
          return reply.code(503).type('application/problem+json').send({
            type: 'about:blank',
            title: 'Monitoring Unavailable',
            status: 503,
            detail: '운영 지표를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
          });
        }
      },
    );
  });
}
