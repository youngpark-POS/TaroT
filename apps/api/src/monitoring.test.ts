import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { loadConfig } from '@tarot/runtime';
import { emptyTotals } from '@tarot/monitoring';
import { registerMonitoring } from './monitoring.js';

let app: FastifyInstance;
const config = loadConfig({
  NODE_ENV: 'test',
  AI_MODE: 'mock',
  MONITORING_USER_POOL_ID: 'pool',
  MONITORING_CLIENT_ID: 'client',
  MONITORING_AUTH_DOMAIN: 'https://auth.example.com',
  MONITORING_SITE_ORIGIN: 'https://site.example.com',
  TELEMETRY_TABLE: 'telemetry',
  AGENT_QUEUE_URL: 'https://sqs.example.com/jobs',
  MONITORING_DLQ_URL: 'https://sqs.example.com/dlq',
});
const sample = {
  generatedAt: '2026-10-04T00:00:00.000Z',
  rangeDays: 7,
  region: 'ap-northeast-2',
  service: { live: true, ready: true, latencyMs: 40 },
  functions: [],
  queues: [],
  alarms: [],
  usage: { totals: emptyTotals(), byAgent: [], daily: [], retentionDays: 90 },
  warnings: [],
};
const provider = vi.fn().mockResolvedValue(sample);
async function setup(enabled = true) {
  provider.mockClear();
  app = Fastify();
  app.setSerializerCompiler(serializerCompiler);
  app.setValidatorCompiler(validatorCompiler);
  await app.register(cookie);
  await registerMonitoring(app, enabled ? config : loadConfig({}), {
    verify: async (token) => {
      if (token !== 'valid-admin') throw new Error('Invalid token');
    },
    snapshot: provider,
  });
  await app.ready();
}
afterEach(async () => {
  await app?.close();
});
describe('administrator monitoring routes', () => {
  it('denies missing and forged sessions before fetching any AWS data', async () => {
    await setup();
    for (const cookieValue of ['', 'tarot_monitoring=forged']) {
      const response = await app.inject({
        url: '/v1/monitoring/snapshot',
        headers: { cookie: cookieValue },
      });
      expect(response.statusCode).toBe(401);
      expect(response.headers['cache-control']).toContain('no-store');
    }
    expect(provider).not.toHaveBeenCalled();
  });
  it('returns aggregates for an admin and validates the supported range', async () => {
    await setup();
    const response = await app.inject({
      url: '/v1/monitoring/snapshot?days=7',
      headers: { cookie: 'tarot_monitoring=valid-admin' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(sample);
    expect(
      (
        await app.inject({
          url: '/v1/monitoring/snapshot?days=999',
          headers: { cookie: 'tarot_monitoring=valid-admin' },
        })
      ).statusCode,
    ).toBe(400);
    await app.inject({
      url: '/v1/monitoring/snapshot',
      headers: { cookie: 'tarot_monitoring=forged' },
    });
    expect(provider).toHaveBeenCalledOnce();
  });
  it('uses PKCE and rejects callbacks without the matching encrypted flow cookie', async () => {
    await setup();
    const response = await app.inject('/v1/monitoring/login');
    const location = new URL(String(response.headers.location));
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_challenge')).toHaveLength(43);
    expect(response.cookies[0]?.httpOnly).toBe(true);
    const rejected = await app.inject('/v1/monitoring/callback?code=anything&state=forged');
    expect(rejected.headers.location).toBe('https://site.example.com/monitoring?auth=failed');
  });
  it('fails closed when monitoring is unconfigured', async () => {
    await setup(false);
    expect((await app.inject('/v1/monitoring/config')).json()).toEqual({ enabled: false });
    expect((await app.inject('/v1/monitoring/snapshot')).statusCode).toBe(503);
  });
});
