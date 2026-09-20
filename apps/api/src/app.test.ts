import type { TarotRepository } from '@tarot/database';
import { loadConfig } from '@tarot/runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('health endpoints', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it('reports liveness without touching the database', async () => {
    const repository = {
      close: async () => undefined,
      isReady: async () => true,
    } as unknown as TarotRepository;
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      repository,
    });

    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('publishes request and response schemas in OpenAPI', async () => {
    const repository = {
      close: async () => undefined,
      isReady: async () => true,
    } as unknown as TarotRepository;
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      repository,
    });

    const response = await app.inject({ method: 'GET', url: '/docs/json' });
    const document = response.json();
    expect(response.statusCode).toBe(200);
    expect(document.paths['/readings'].post.requestBody).toBeDefined();
    expect(document.paths['/readings/{id}/reveals'].post.responses['200']).toBeDefined();
  });
});
