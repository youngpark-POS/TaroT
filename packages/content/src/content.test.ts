import { describe, expect, it } from 'vitest';
import { cardSchema, spreadSchema } from '@tarot/contracts';
import { cards, spreads } from './index.js';

describe('canonical tarot content', () => {
  it('contains a complete Rider-Waite-Smith deck', () => {
    expect(cards).toHaveLength(78);
    expect(cards.filter((card) => card.arcana === 'major')).toHaveLength(22);
    expect(cards.filter((card) => card.arcana === 'minor')).toHaveLength(56);
    expect(new Set(cards.map((card) => card.id)).size).toBe(78);
    cards.forEach((card) => expect(cardSchema.safeParse(card).success).toBe(true));
  });

  it('contains six internally consistent spreads', () => {
    expect(spreads).toHaveLength(6);
    spreads.forEach((spread) => {
      expect(spread.positions).toHaveLength(spread.cardCount);
      expect(spreadSchema.safeParse(spread).success).toBe(true);
    });
  });
});
