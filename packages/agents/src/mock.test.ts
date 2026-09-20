import { describe, expect, it } from 'vitest';
import { spreads } from '@tarot/content';
import { MockSpreadAgent } from './index.js';
import { spreadEvalCases } from '../evals/spread-cases.js';
import { readingEvalCases } from '../evals/reading-cases.js';

describe('MockSpreadAgent', () => {
  it('chooses relationship spread for relationship questions', async () => {
    const output = await new MockSpreadAgent().recommend({
      question: '연인과 반복되는 갈등에서 무엇을 살펴봐야 할까요?',
      clarificationAllowed: false,
      spreads,
    });
    expect(output.recommendations[0]?.spreadId).toBe('relationship-mirror');
    expect(output.recommendations).toHaveLength(3);
  });
});

describe('60-question spread evaluation set', () => {
  it('keeps deterministic recommendations inside the approved catalog', async () => {
    const agent = new MockSpreadAgent();
    const catalogIds = new Set(spreads.map((spread) => spread.id));
    let top1 = 0;
    let top3 = 0;

    for (const testCase of spreadEvalCases) {
      const output = await agent.recommend({
        question: testCase.question,
        clarificationAllowed: false,
        spreads,
      });
      const ids = output.recommendations.map((item) => item.spreadId);
      if (ids[0] === testCase.expectedTop1) top1 += 1;
      if (ids.some((id) => testCase.acceptedTop3.includes(id))) top3 += 1;
      expect(ids).toHaveLength(3);
      expect(ids.every((id) => catalogIds.has(id))).toBe(true);
    }

    expect(top1 / spreadEvalCases.length).toBeGreaterThanOrEqual(0.85);
    expect(top3 / spreadEvalCases.length).toBeGreaterThanOrEqual(0.95);
  });
});

describe('30 fixed reading evaluation cases', () => {
  it('keeps every fixed draw structurally valid', () => {
    expect(readingEvalCases).toHaveLength(30);
    for (const testCase of readingEvalCases) {
      expect(testCase.cards).toHaveLength(testCase.spread.cardCount);
      expect(testCase.cards.map((item) => item.positionIndex)).toEqual(
        Array.from({ length: testCase.spread.cardCount }, (_, index) => index),
      );
      expect(new Set(testCase.cards.map((item) => item.card.id)).size).toBe(testCase.cards.length);
    }
  });
});
