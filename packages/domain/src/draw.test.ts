import { describe, expect, it } from 'vitest';
import { drawCards, type RandomSource } from './index.js';

class SequenceRandom implements RandomSource {
  private value = 0;
  int(maxExclusive: number) {
    const result = this.value % maxExclusive;
    this.value += 1;
    return result;
  }
}

describe('drawCards', () => {
  it('draws unique cards and directions', () => {
    const result = drawCards(['a', 'b', 'c', 'd', 'e'], 4, new SequenceRandom());
    expect(new Set(result.map((item) => item.cardId)).size).toBe(4);
    expect(result.map((item) => item.positionIndex)).toEqual([0, 1, 2, 3]);
    expect(result.every((item) => ['upright', 'reversed'].includes(item.orientation))).toBe(true);
  });

  it('rejects an impossible draw', () => {
    expect(() => drawCards(['a'], 2, new SequenceRandom())).toThrow('Invalid draw count');
  });
});
