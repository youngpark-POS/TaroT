import { randomInt } from 'node:crypto';
import type {
  Orientation,
  ReadingResult,
  Spread,
  SpreadAgentOutput,
  TarotCard,
} from '@tarot/contracts';

export interface RandomSource {
  int(maxExclusive: number): number;
}

export const cryptoRandom: RandomSource = {
  int: (maxExclusive) => randomInt(maxExclusive),
};

export interface DrawnCard {
  positionIndex: number;
  cardId: string;
  orientation: Orientation;
}

export function drawCards(
  cardIds: readonly string[],
  count: number,
  random: RandomSource = cryptoRandom,
): DrawnCard[] {
  if (count < 1 || count > cardIds.length) throw new Error('Invalid draw count');
  const deck = [...cardIds];
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = random.int(index + 1);
    [deck[index], deck[swapIndex]] = [deck[swapIndex]!, deck[index]!];
  }
  return deck.slice(0, count).map((cardId, positionIndex) => ({
    positionIndex,
    cardId,
    orientation: random.int(2) === 0 ? 'upright' : 'reversed',
  }));
}

const highRiskPatterns = [
  /진단|증상|약을?\s*(먹|끊)|수술|임신|치료|의사/i,
  /소송|고소|계약서|법적|변호사|형사|민사/i,
  /주식|코인|투자|대출|매수|매도|수익률/i,
  /자살|죽고\s*싶|자해|해치고\s*싶|살인/i,
];
const crisisPatterns = [/자살|죽고\s*싶|자해|해치고\s*싶|살인|지금\s*죽/i];

export function classifySafety(question: string): { highRisk: boolean; crisis: boolean } {
  return {
    highRisk: highRiskPatterns.some((pattern) => pattern.test(question)),
    crisis: crisisPatterns.some((pattern) => pattern.test(question)),
  };
}

export interface SpreadAgentGateway {
  recommend(input: {
    question: string;
    clarification?: string;
    clarificationAllowed: boolean;
    spreads: Spread[];
  }): Promise<SpreadAgentOutput>;
}

export interface ReadingAgentGateway {
  interpret(input: {
    question: string;
    spread: Spread;
    cards: Array<{ card: TarotCard; orientation: Orientation; positionIndex: number }>;
    highRisk: boolean;
    crisis: boolean;
  }): Promise<ReadingResult>;
}

export class DomainError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}
