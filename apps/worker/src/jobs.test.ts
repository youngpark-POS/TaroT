import { cards, CONTENT_VERSION, spreads } from '@tarot/content';
import type { ReadingResult, SpreadAgentOutput } from '@tarot/contracts';
import type { StoredReading, TarotRepositoryPort } from '@tarot/database';
import { encrypt, loadConfig } from '@tarot/runtime';
import { describe, expect, it } from 'vitest';
import { createAgentJobProcessor } from './jobs.js';

const config = loadConfig({ NODE_ENV: 'test', AI_MODE: 'mock' });

function reading(overrides?: Partial<StoredReading>): StoredReading {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    sessionHash: 'session',
    status: 'recommending',
    questionEncrypted: encrypt('앞으로의 진로 흐름이 궁금해요.', config.DATA_ENCRYPTION_KEY),
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
      recommendationJobVersion: 1,
      interpretationJobVersion: 0,
      interpretationStatus: 'idle',
      dispatchPending: null,
    },
    contentVersion: CONTENT_VERSION,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('Lambda agent jobs', () => {
  it('stores a valid spread recommendation for the matching job version', async () => {
    const current = reading();
    let saved: SpreadAgentOutput | undefined;
    const repository = {
      getReading: async () => current,
      listSpreads: async () => spreads,
      saveSpreadRecommendation: async (
        _id: string,
        _version: number,
        output: SpreadAgentOutput,
      ) => {
        saved = output;
        return true;
      },
      claimAgentJob: async () => true,
      completeAgentJob: async () => undefined,
    } as unknown as TarotRepositoryPort;

    await createAgentJobProcessor(config, repository).process({
      type: 'recommend_spread',
      readingId: current.id,
      version: 1,
    });

    expect(saved?.recommendations).toHaveLength(3);
  });

  it('prepares interpretation without changing the public reveal state', async () => {
    const spread = spreads.find((item) => item.id === 'single-insight')!;
    const card = cards[0]!;
    const current = reading({
      status: 'revealing',
      state: {
        ...reading().state,
        selectedSpreadId: spread.id,
        draw: [{ positionIndex: 0, cardId: card.id, orientation: 'upright' }],
        interpretationJobVersion: 1,
        interpretationStatus: 'pending',
      },
    });
    let saved: ReadingResult | undefined;
    const repository = {
      getReading: async () => current,
      getSpread: async () => spread,
      getCard: async () => card,
      updateReading: async () => true,
      savePreparedInterpretation: async (_id: string, encrypted: string) => {
        const { decrypt } = await import('@tarot/runtime');
        saved = decrypt<ReadingResult>(encrypted, config.DATA_ENCRYPTION_KEY);
      },
      claimAgentJob: async () => true,
      completeAgentJob: async () => undefined,
    } as unknown as TarotRepositoryPort;

    await createAgentJobProcessor(config, repository).process({
      type: 'interpret_reading',
      readingId: current.id,
      version: 1,
    });

    expect(saved?.cards).toHaveLength(1);
    expect(current.status).toBe('revealing');
  });
});
