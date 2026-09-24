import { cards, spreads } from '@tarot/content';
import type { StoredReading, TarotRepository, TarotRepositoryPort } from '@tarot/database';
import { encrypt, keyedHash, loadConfig } from '@tarot/runtime';
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

describe('prepared interpretation flow', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it('queues interpretation on spread selection and completes immediately after the final reveal', async () => {
    const config = loadConfig({ NODE_ENV: 'test' });
    const sessionToken = 'test-session-token';
    const spread = spreads.find((item) => item.id === 'single-insight')!;
    const enqueuedReadingIds: string[] = [];
    let reading: StoredReading = {
      id: '11111111-1111-4111-8111-111111111111',
      sessionHash: keyedHash(sessionToken, config.SESSION_HMAC_KEY),
      status: 'awaiting_spread',
      questionEncrypted: encrypt('지금 제게 필요한 흐름은 무엇인가요?', config.DATA_ENCRYPTION_KEY),
      clarificationEncrypted: null,
      resultEncrypted: null,
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
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const repository = {
      close: async () => undefined,
      listSpreads: async () => spreads,
      listCards: async () => cards,
      getSpread: async (id: string) => (id === spread.id ? spread : null),
      getCard: async (id: string) => cards.find((card) => card.id === id) ?? null,
      getReading: async (id: string, hash?: string) =>
        id === reading.id && (!hash || hash === reading.sessionHash) ? reading : null,
      updateReading: async (_id: string, values: Partial<StoredReading>) => {
        reading = { ...reading, ...values, updatedAt: new Date() };
        return true;
      },
      advanceReveal: async (
        _id: string,
        _expectedRevealedCount: number,
        nextRevealedCount: number,
        finished: boolean,
      ) => {
        const status = finished
          ? reading.resultEncrypted
            ? ('completed' as const)
            : ('interpreting' as const)
          : ('revealing' as const);
        reading = {
          ...reading,
          status,
          state: { ...reading.state, revealedCount: nextRevealedCount },
          updatedAt: new Date(),
        };
        return status;
      },
      enqueueInterpretation: async (_id: string, readingId: string) => {
        enqueuedReadingIds.push(readingId);
      },
      getIdempotentResponse: async () => null,
      saveIdempotentResponse: async () => undefined,
    } as unknown as TarotRepository;
    app = await buildApp({ config, repository });
    const cookie = `tarot_session=${sessionToken}`;

    const selection = await app.inject({
      method: 'POST',
      url: `/v1/readings/${reading.id}/spread`,
      headers: { cookie },
      payload: { spreadId: spread.id },
    });

    expect(selection.statusCode).toBe(200);
    expect(selection.json()).toMatchObject({ status: 'revealing', revealedCards: [] });
    expect(reading.state.draw).toHaveLength(1);
    expect(enqueuedReadingIds).toEqual([reading.id]);

    reading = { ...reading, resultEncrypted: 'prepared-result' };
    const reveal = await app.inject({
      method: 'POST',
      url: `/v1/readings/${reading.id}/reveals`,
      headers: { cookie, 'idempotency-key': 'prepared-result-test' },
      payload: { positionIndex: 0 },
    });

    expect(reveal.statusCode).toBe(200);
    expect(reveal.json()).toMatchObject({ status: 'completed', nextPositionIndex: null });
    expect(reading.status).toBe('completed');
  });
});

describe('serverless recommendation flow', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it('returns 202 and dispatches only an opaque recommendation job', async () => {
    let stored: StoredReading | undefined;
    const dispatched: Array<{ readingId: string; version: number }> = [];
    const repository = {
      asyncAgents: true,
      close: async () => undefined,
      listSpreads: async () => spreads,
      listCards: async () => cards,
      consumeRateLimit: async () => ({ allowed: true, remaining: 4 }),
      createReading: async (reading: StoredReading) => {
        stored = reading;
      },
      enqueueRecommendation: async (readingId: string, version: number) => {
        dispatched.push({ readingId, version });
      },
    } as unknown as TarotRepositoryPort;
    app = await buildApp({ config: loadConfig({ NODE_ENV: 'test' }), repository });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/readings',
      payload: { question: '새로운 일을 시작해도 괜찮을까요?' },
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers['retry-after']).toBe('2');
    expect(response.json()).toMatchObject({ status: 'recommending', recommendations: [] });
    expect(stored?.state.dispatchPending).toEqual({ type: 'recommend_spread', version: 1 });
    expect(dispatched).toEqual([{ readingId: stored?.id, version: 1 }]);
  });
});
