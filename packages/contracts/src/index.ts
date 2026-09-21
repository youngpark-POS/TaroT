import { z } from 'zod';

export const readingStatusSchema = z.enum([
  'needs_clarification',
  'awaiting_spread',
  'revealing',
  'interpreting',
  'completed',
  'failed',
  'expired',
]);
export type ReadingStatus = z.infer<typeof readingStatusSchema>;

export const orientationSchema = z.enum(['upright', 'reversed']);
export type Orientation = z.infer<typeof orientationSchema>;

export const coordinateSchema = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  rotation: z.number().default(0),
});

export const spreadPositionSchema = z.object({
  id: z.string(),
  order: z.number().int().nonnegative(),
  name: z.string(),
  prompt: z.string(),
  coordinate: coordinateSchema,
});
export type SpreadPosition = z.infer<typeof spreadPositionSchema>;

export const spreadSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  cardCount: z.number().int().min(1).max(10),
  durationMinutes: z.number().int().positive(),
  suitableFor: z.array(z.string()),
  unsuitableFor: z.array(z.string()),
  positions: z.array(spreadPositionSchema),
  sourceIds: z.array(z.string()),
});
export type Spread = z.infer<typeof spreadSchema>;

export const spreadRecommendationSchema = z.object({
  spreadId: z.string(),
  reason: z.string().min(1).max(240),
});
export type SpreadRecommendation = z.infer<typeof spreadRecommendationSchema>;

export const cardMeaningSchema = z.object({
  keywords: z.array(z.string()).min(2),
  reflection: z.string(),
  caution: z.string(),
});

export const cardSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameEn: z.string(),
  arcana: z.enum(['major', 'minor']),
  suit: z.enum(['major', 'wands', 'cups', 'swords', 'pentacles']),
  rank: z.string(),
  imagePath: z.string(),
  alt: z.string(),
  symbols: z.array(z.string()),
  upright: cardMeaningSchema,
  reversed: cardMeaningSchema,
  sourceIds: z.array(z.string()),
});
export type TarotCard = z.infer<typeof cardSchema>;

export const revealedCardSchema = z.object({
  positionIndex: z.number().int().nonnegative(),
  position: spreadPositionSchema,
  card: cardSchema.pick({ id: true, name: true, nameEn: true, imagePath: true, alt: true }),
  orientation: orientationSchema,
});
export type RevealedCard = z.infer<typeof revealedCardSchema>;

export const createReadingRequestSchema = z.object({
  question: z.string().trim().min(5).max(500),
});

export const clarificationRequestSchema = z
  .object({
    answer: z.string().trim().max(500).optional(),
    skip: z.boolean().default(false),
  })
  .refine((value) => value.skip || (value.answer?.length ?? 0) >= 2, {
    message: '답변을 입력하거나 건너뛰기를 선택해 주세요.',
  });

export const selectSpreadRequestSchema = z.object({ spreadId: z.string() });
export const revealRequestSchema = z.object({ positionIndex: z.number().int().nonnegative() });

export const cardInterpretationSchema = z.object({
  positionIndex: z.number().int().nonnegative(),
  positionName: z.string(),
  cardId: z.string(),
  cardName: z.string(),
  orientation: orientationSchema,
  interpretation: z
    .string()
    .describe('질문과 위치에 직접 답하는 구체적인 한국어 점술형 해석 2~3문장'),
});

export const readingResultSchema = z.object({
  summary: z.string().describe('전체 흐름과 가까운 전개를 요약하는 한국어 점술형 해석 2~3문장'),
  themes: z.array(z.string()).min(1).max(5),
  cards: z.array(cardInterpretationSchema),
  reflectionQuestions: z.array(z.string()).min(2).max(3),
  safetyNotice: z.string().optional(),
  fallback: z.boolean().default(false),
});
export type ReadingResult = z.infer<typeof readingResultSchema>;

export const publicReadingSchema = z.object({
  id: z.string().uuid(),
  status: readingStatusSchema,
  question: z.string(),
  highRisk: z.boolean(),
  crisis: z.boolean(),
  clarificationQuestion: z.string().nullable(),
  recommendations: z.array(spreadRecommendationSchema),
  availableSpreads: z.array(spreadSchema),
  selectedSpread: spreadSchema.nullable(),
  revealedCards: z.array(revealedCardSchema),
  nextPositionIndex: z.number().int().nonnegative().nullable(),
  expiresAt: z.string(),
});
export type PublicReading = z.infer<typeof publicReadingSchema>;

export const spreadAgentOutputSchema = z.object({
  clarificationQuestion: z.string().max(180).nullable(),
  recommendations: z.array(spreadRecommendationSchema).max(3),
});
export type SpreadAgentOutput = z.infer<typeof spreadAgentOutputSchema>;

export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  instance: z.string().optional(),
});
export type Problem = z.infer<typeof problemSchema>;
