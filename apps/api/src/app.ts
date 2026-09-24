import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { MockSpreadAgent, createAgentGateways } from '@tarot/agents';
import {
  clarificationRequestSchema,
  createReadingRequestSchema,
  publicReadingSchema,
  readingResultSchema,
  revealedCardSchema,
  revealRequestSchema,
  selectSpreadRequestSchema,
  type PublicReading,
  type ReadingResult,
  type RevealedCard,
  type Spread,
} from '@tarot/contracts';
import { CONTENT_VERSION } from '@tarot/content';
import {
  createTarotRepository,
  type StoredReading,
  type StoredReadingState,
  type TarotRepositoryPort,
} from '@tarot/database';
import { classifySafety, DomainError, drawCards } from '@tarot/domain';
import {
  decrypt,
  encrypt,
  keyedHash,
  loadConfig,
  newSessionToken,
  type AppConfig,
} from '@tarot/runtime';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { z, ZodError } from 'zod';

const SESSION_COOKIE = 'tarot_session';
const DAY_MS = 24 * 60 * 60 * 1_000;

const problem = (
  reply: FastifyReply,
  status: number,
  title: string,
  detail: string,
  instance?: string,
) =>
  reply
    .code(status)
    .type('application/problem+json')
    .send({
      type: `https://tarot.local/problems/${title.toLowerCase().replaceAll(' ', '-')}`,
      title,
      status,
      detail,
      instance,
    });

function sessionHash(request: FastifyRequest, config: AppConfig): string {
  const token = request.cookies[SESSION_COOKIE];
  if (!token)
    throw new DomainError(
      '익명 세션이 없습니다. 첫 화면에서 새 리딩을 시작해 주세요.',
      401,
      'missing_session',
    );
  return keyedHash(token, config.SESSION_HMAC_KEY);
}

function ensureSession(request: FastifyRequest, reply: FastifyReply, config: AppConfig): string {
  let token = request.cookies[SESSION_COOKIE];
  if (!token) {
    token = newSessionToken();
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60,
    });
  }
  return keyedHash(token, config.SESSION_HMAC_KEY);
}

async function toPublicReading(
  repository: TarotRepositoryPort,
  config: AppConfig,
  reading: StoredReading,
): Promise<PublicReading> {
  const question = decrypt<string>(reading.questionEncrypted, config.DATA_ENCRYPTION_KEY);
  const availableSpreads = await repository.listSpreads();
  const selectedSpread = reading.state.selectedSpreadId
    ? (availableSpreads.find((spread) => spread.id === reading.state.selectedSpreadId) ?? null)
    : null;
  const allCards = new Map((await repository.listCards()).map((card) => [card.id, card]));
  const revealedCards: RevealedCard[] = reading.state.draw
    .slice(0, reading.state.revealedCount)
    .map((draw) => {
      const card = allCards.get(draw.cardId);
      const position = selectedSpread?.positions[draw.positionIndex];
      if (!card || !position) throw new Error('Reading references missing content.');
      return {
        positionIndex: draw.positionIndex,
        position,
        card: {
          id: card.id,
          name: card.name,
          nameEn: card.nameEn,
          imagePath: card.imagePath,
          alt: card.alt,
        },
        orientation: draw.orientation,
      };
    });
  return publicReadingSchema.parse({
    id: reading.id,
    status: reading.status,
    question,
    highRisk: reading.state.highRisk,
    crisis: reading.state.crisis,
    clarificationQuestion: reading.state.clarificationQuestion,
    recommendations: reading.state.recommendations,
    availableSpreads,
    selectedSpread,
    revealedCards,
    nextPositionIndex:
      reading.status === 'revealing' &&
      selectedSpread &&
      reading.state.revealedCount < selectedSpread.cardCount
        ? reading.state.revealedCount
        : null,
    expiresAt: reading.expiresAt.toISOString(),
  });
}

function assertValidRecommendations(
  output: {
    clarificationQuestion: string | null;
    recommendations: Array<{ spreadId: string; reason: string }>;
  },
  spreads: Spread[],
) {
  const ids = new Set(spreads.map((spread) => spread.id));
  if (output.clarificationQuestion) return;
  if (
    output.recommendations.length !== 3 ||
    output.recommendations.some((item) => !ids.has(item.spreadId))
  ) {
    throw new Error('Agent returned invalid spread recommendations.');
  }
}

const isModelRefusal = (error: unknown) =>
  error instanceof Error && error.name === 'ModelRefusalError';

export async function buildApp(overrides?: {
  config?: AppConfig;
  repository?: TarotRepositoryPort;
}) {
  const config = overrides?.config ?? loadConfig();
  const repository =
    overrides?.repository ??
    createTarotRepository({
      STORAGE_DRIVER: config.STORAGE_DRIVER,
      DATABASE_URL: config.DATABASE_URL,
      READINGS_TABLE: config.READINGS_TABLE,
      CONTENT_TABLE: config.CONTENT_TABLE,
      RATE_LIMITS_TABLE: config.RATE_LIMITS_TABLE,
      AGENT_QUEUE_URL: config.AGENT_QUEUE_URL,
      contentVersion: CONTENT_VERSION,
    });
  const app = Fastify({
    logger: { redact: ['req.headers.cookie', 'req.body.question', 'req.body.answer'] },
    bodyLimit: 16_384,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const gateways = createAgentGateways({
    mode: config.AI_MODE,
    spreadModel: config.SPREAD_MODEL,
    readingModel: config.READING_MODEL,
  });

  await app.register(cookie);
  if (config.WEB_ORIGIN) {
    await app.register(cors, {
      origin: config.WEB_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST'],
    });
  }
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(swagger, {
    openapi: { info: { title: 'TaroT Headless API', version: '1.0.0' }, servers: [{ url: '/v1' }] },
    transform: jsonSchemaTransform,
  });
  // The Swagger UI package ships static files that are intentionally excluded
  // from the single-file Lambda bundle. Keep interactive docs for local and
  // test environments while avoiding a public production docs endpoint.
  if (config.NODE_ENV !== 'production') {
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  app.addHook('onClose', async () => repository.close());

  app.get(
    '/health/live',
    { schema: { response: { 200: z.object({ status: z.literal('ok') }) } } },
    async () => ({ status: 'ok' as const }),
  );
  app.get('/health/ready', async (_request, reply) => {
    try {
      await repository.isReady();
      return { status: 'ready' };
    } catch {
      return problem(reply, 503, 'Not Ready', 'Database is unavailable.');
    }
  });

  app.post(
    '/v1/readings',
    {
      schema: {
        body: createReadingRequestSchema,
        response: { 201: publicReadingSchema, 202: publicReadingSchema },
      },
    },
    async (request, reply) => {
      const { question } = createReadingRequestSchema.parse(request.body);
      const currentSessionHash = ensureSession(request, reply, config);
      const forwarded = request.headers['x-forwarded-for'];
      const ip = typeof forwarded === 'string' ? forwarded.split(',')[0]!.trim() : request.ip;
      const bucket = keyedHash(`${currentSessionHash}:${ip}`, config.RATE_LIMIT_HMAC_KEY);
      const rate = await repository.consumeRateLimit(bucket, 5);
      if (!rate.allowed) {
        reply.header('Retry-After', '3600');
        return problem(
          reply,
          429,
          'Rate Limit',
          '시간당 리딩 5회를 모두 사용했어요. 다음 시간에 다시 시도해 주세요.',
        );
      }
      const availableSpreads = await repository.listSpreads();
      const safety = classifySafety(question);
      let recommendation = { clarificationQuestion: null, recommendations: [] } as {
        clarificationQuestion: string | null;
        recommendations: Array<{ spreadId: string; reason: string }>;
      };
      let recommendationRefused = false;
      if (!repository.asyncAgents) {
        try {
          recommendation = await gateways.spreadAgent.recommend({
            question,
            clarificationAllowed: true,
            spreads: availableSpreads,
          });
          assertValidRecommendations(recommendation, availableSpreads);
        } catch (error) {
          if (isModelRefusal(error)) {
            recommendationRefused = true;
          } else {
            request.log.warn(
              { errorType: error instanceof Error ? error.name : 'UnknownError' },
              'Spread agent failed; using deterministic fallback',
            );
            recommendation = await new MockSpreadAgent().recommend({
              question,
              clarificationAllowed: false,
              spreads: availableSpreads,
            });
          }
        }
      }
      const id = randomUUID();
      const recommendationJobVersion = repository.asyncAgents ? 1 : 0;
      const state: StoredReadingState = {
        ...safety,
        clarificationQuestion: recommendation.clarificationQuestion,
        clarificationUsed: false,
        recommendations: recommendation.recommendations,
        selectedSpreadId: null,
        draw: [],
        revealedCount: 0,
        recommendationJobVersion,
        interpretationJobVersion: 0,
        interpretationStatus: 'idle',
        dispatchPending: repository.asyncAgents
          ? { type: 'recommend_spread', version: recommendationJobVersion }
          : null,
      };
      const reading: StoredReading = {
        id,
        sessionHash: currentSessionHash,
        status: repository.asyncAgents
          ? 'recommending'
          : recommendationRefused
            ? 'failed'
            : recommendation.clarificationQuestion
              ? 'needs_clarification'
              : 'awaiting_spread',
        questionEncrypted: encrypt(question, config.DATA_ENCRYPTION_KEY),
        clarificationEncrypted: null,
        resultEncrypted: null,
        state,
        contentVersion: CONTENT_VERSION,
        expiresAt: new Date(Date.now() + DAY_MS),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await repository.createReading(reading);
      if (repository.asyncAgents) {
        try {
          await repository.enqueueRecommendation(id, recommendationJobVersion);
        } catch (error) {
          request.log.error({ err: error, readingId: id }, 'Recommendation dispatch deferred');
        }
        reply.header('Retry-After', '2');
        return reply.code(202).send(await toPublicReading(repository, config, reading));
      }
      return reply.code(201).send(await toPublicReading(repository, config, reading));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/readings/:id/clarification',
    {
      schema: {
        body: clarificationRequestSchema,
        response: { 200: publicReadingSchema, 202: publicReadingSchema },
      },
    },
    async (request, reply) => {
      const body = clarificationRequestSchema.parse(request.body);
      const hash = sessionHash(request, config);
      const reading = await repository.getReading(request.params.id, hash);
      if (!reading)
        throw new DomainError('리딩을 찾을 수 없거나 만료되었어요.', 404, 'reading_not_found');
      if (reading.status !== 'needs_clarification' || reading.state.clarificationUsed) {
        throw new DomainError('이 리딩은 보충 질문을 받을 수 없는 상태예요.', 409, 'invalid_state');
      }
      const question = decrypt<string>(reading.questionEncrypted, config.DATA_ENCRYPTION_KEY);
      const answer = body.skip ? '보충 설명 없이 현재 질문으로 진행' : body.answer!;
      const availableSpreads = await repository.listSpreads();
      if (repository.asyncAgents) {
        const jobVersion = (reading.state.recommendationJobVersion ?? 0) + 1;
        const state: StoredReadingState = {
          ...reading.state,
          clarificationQuestion: null,
          clarificationUsed: true,
          recommendations: [],
          recommendationJobVersion: jobVersion,
          dispatchPending: { type: 'recommend_spread', version: jobVersion },
        };
        const updated = await repository.updateReading(
          reading.id,
          {
            status: 'recommending',
            state,
            clarificationEncrypted: encrypt(answer, config.DATA_ENCRYPTION_KEY),
          },
          { status: 'needs_clarification' },
        );
        if (updated === false)
          throw new DomainError('리딩 상태가 이미 변경되었어요.', 409, 'state_conflict');
        try {
          await repository.enqueueRecommendation(reading.id, jobVersion);
        } catch (error) {
          request.log.error(
            { err: error, readingId: reading.id },
            'Recommendation dispatch deferred',
          );
        }
        const refreshed = await repository.getReading(reading.id, hash);
        reply.header('Retry-After', '2');
        return reply.code(202).send(await toPublicReading(repository, config, refreshed!));
      }
      let recommendation;
      try {
        recommendation = await gateways.spreadAgent.recommend({
          question,
          clarification: answer,
          clarificationAllowed: false,
          spreads: availableSpreads,
        });
        assertValidRecommendations(recommendation, availableSpreads);
      } catch (error) {
        if (isModelRefusal(error)) {
          await repository.updateReading(reading.id, { status: 'failed' });
          const refused = await repository.getReading(reading.id, hash);
          return reply.send(await toPublicReading(repository, config, refused!));
        }
        recommendation = await new MockSpreadAgent().recommend({
          question: `${question} ${answer}`,
          clarificationAllowed: false,
          spreads: availableSpreads,
        });
      }
      const state = {
        ...reading.state,
        clarificationQuestion: null,
        clarificationUsed: true,
        recommendations: recommendation.recommendations,
      };
      await repository.updateReading(reading.id, {
        status: 'awaiting_spread',
        state,
        clarificationEncrypted: encrypt(answer, config.DATA_ENCRYPTION_KEY),
      });
      const updated = await repository.getReading(reading.id, hash);
      return reply.send(await toPublicReading(repository, config, updated!));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/readings/:id/spread',
    { schema: { body: selectSpreadRequestSchema, response: { 200: publicReadingSchema } } },
    async (request, reply) => {
      const { spreadId } = selectSpreadRequestSchema.parse(request.body);
      const hash = sessionHash(request, config);
      const reading = await repository.getReading(request.params.id, hash);
      if (!reading)
        throw new DomainError('리딩을 찾을 수 없거나 만료되었어요.', 404, 'reading_not_found');
      if (reading.status !== 'awaiting_spread')
        throw new DomainError('스프레드를 선택할 수 없는 상태예요.', 409, 'invalid_state');
      const spread = await repository.getSpread(spreadId);
      if (!spread) throw new DomainError('존재하지 않는 스프레드예요.', 400, 'invalid_spread');
      const deck = await repository.listCards();
      const interpretationJobVersion = (reading.state.interpretationJobVersion ?? 0) + 1;
      const state: StoredReadingState = {
        ...reading.state,
        selectedSpreadId: spread.id,
        draw: drawCards(
          deck.map((card) => card.id),
          spread.cardCount,
        ),
        revealedCount: 0,
        interpretationJobVersion,
        interpretationStatus: 'pending',
        dispatchPending: repository.asyncAgents
          ? { type: 'interpret_reading', version: interpretationJobVersion }
          : null,
      };
      const selected = await repository.updateReading(
        reading.id,
        { status: 'revealing', state },
        { status: 'awaiting_spread' },
      );
      if (selected === false)
        throw new DomainError('스프레드가 이미 선택되었어요.', 409, 'state_conflict');
      try {
        await repository.enqueueInterpretation(randomUUID(), reading.id, interpretationJobVersion);
      } catch (error) {
        request.log.error(
          { err: error, readingId: reading.id },
          'Interpretation dispatch deferred',
        );
      }
      const updated = await repository.getReading(reading.id, hash);
      return reply.send(await toPublicReading(repository, config, updated!));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/readings/:id/reveals',
    {
      schema: {
        body: revealRequestSchema,
        response: {
          200: z.object({
            revealed: revealedCardSchema,
            status: z.enum(['revealing', 'interpreting', 'completed']),
            nextPositionIndex: z.number().int().nonnegative().nullable(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { positionIndex } = revealRequestSchema.parse(request.body);
      const keyHeader = request.headers['idempotency-key'];
      if (typeof keyHeader !== 'string' || keyHeader.length < 8 || keyHeader.length > 128) {
        throw new DomainError('Idempotency-Key 헤더가 필요해요.', 400, 'missing_idempotency_key');
      }
      const hash = sessionHash(request, config);
      const reading = await repository.getReading(request.params.id, hash);
      if (!reading)
        throw new DomainError('리딩을 찾을 수 없거나 만료되었어요.', 404, 'reading_not_found');
      const existing = await repository.getIdempotentResponse(request.params.id, keyHeader);
      if (existing) return reply.send(existing);
      if (reading.status !== 'revealing')
        throw new DomainError('카드를 공개할 수 없는 상태예요.', 409, 'invalid_state');
      if (positionIndex !== reading.state.revealedCount) {
        throw new DomainError(
          `다음으로 ${reading.state.revealedCount + 1}번째 카드를 공개해 주세요.`,
          409,
          'wrong_reveal_order',
        );
      }
      const spread = await repository.getSpread(reading.state.selectedSpreadId!);
      const drawn = reading.state.draw[positionIndex];
      const card = drawn ? await repository.getCard(drawn.cardId) : null;
      const position = spread?.positions[positionIndex];
      if (!spread || !drawn || !card || !position) throw new Error('Stored draw is inconsistent.');
      const revealed: RevealedCard = {
        positionIndex,
        position,
        card: {
          id: card.id,
          name: card.name,
          nameEn: card.nameEn,
          imagePath: card.imagePath,
          alt: card.alt,
        },
        orientation: drawn.orientation,
      };
      const revealedCount = reading.state.revealedCount + 1;
      const finished = revealedCount === spread.cardCount;
      let responseStatus: 'revealing' | 'interpreting' | 'completed' = finished
        ? reading.resultEncrypted
          ? 'completed'
          : 'interpreting'
        : 'revealing';
      const advanced = await repository.advanceReveal(
        reading.id,
        reading.state.revealedCount,
        revealedCount,
        finished,
      );
      if (advanced === null) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const replay = await repository.getIdempotentResponse(request.params.id, keyHeader);
          if (replay) return reply.send(replay);
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new DomainError('카드 공개 상태가 이미 변경되었어요.', 409, 'state_conflict');
      }
      responseStatus = advanced;
      if (finished && !repository.asyncAgents) {
        // Compatibility path for readings whose spread was selected before pre-generation existed.
        await repository.enqueueInterpretation(randomUUID(), reading.id);
        const refreshed = await repository.getReading(reading.id, hash);
        if (refreshed?.resultEncrypted && refreshed.status === 'interpreting') {
          responseStatus = 'completed';
          await repository.updateReading(reading.id, { status: responseStatus });
        }
      }
      const response = {
        revealed,
        status: responseStatus,
        nextPositionIndex: finished ? null : revealedCount,
      };
      await repository.saveIdempotentResponse(reading.id, keyHeader, response);
      return reply.send(response);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/v1/readings/:id',
    { schema: { response: { 200: publicReadingSchema } } },
    async (request, reply) => {
      const hash = sessionHash(request, config);
      const reading = await repository.getReading(request.params.id, hash);
      if (!reading)
        return problem(
          reply,
          404,
          'Reading Not Found',
          '리딩을 찾을 수 없거나 24시간이 지나 만료되었어요.',
        );
      return reply.send(await toPublicReading(repository, config, reading));
    },
  );

  app.get<{ Params: { id: string } }>(
    '/v1/readings/:id/result',
    { schema: { response: { 200: readingResultSchema } } },
    async (request, reply) => {
      const hash = sessionHash(request, config);
      const reading = await repository.getReading(request.params.id, hash);
      if (!reading)
        return problem(reply, 404, 'Reading Not Found', '리딩을 찾을 수 없거나 만료되었어요.');
      if (reading.status === 'interpreting') {
        reply.header('Retry-After', '2');
        return reply.code(202).send({ status: 'interpreting' });
      }
      if (!['completed', 'failed'].includes(reading.status) || !reading.resultEncrypted) {
        return problem(reply, 409, 'Result Not Ready', '모든 카드를 먼저 공개해 주세요.');
      }
      const result = decrypt<ReadingResult>(reading.resultEncrypted, config.DATA_ENCRYPTION_KEY);
      return reply.send(readingResultSchema.parse(result));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/readings/:id/interpretation/retry',
    { schema: { response: { 200: publicReadingSchema } } },
    async (request, reply) => {
      const hash = sessionHash(request, config);
      const reading = await repository.getReading(request.params.id, hash);
      if (!reading)
        throw new DomainError('리딩을 찾을 수 없거나 만료되었어요.', 404, 'reading_not_found');
      if (reading.status !== 'failed')
        throw new DomainError('실패한 해석만 다시 요청할 수 있어요.', 409, 'invalid_state');

      await repository.restartInterpretation(reading.id);
      if (!repository.asyncAgents) {
        await repository.updateReading(reading.id, { status: 'interpreting' });
      }
      const updated = await repository.getReading(reading.id, hash);
      return reply.send(await toPublicReading(repository, config, updated!));
    },
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError)
      return problem(reply, error.status, error.code, error.message, request.url);
    if (error instanceof ZodError)
      return problem(
        reply,
        400,
        'Invalid Request',
        error.issues.map((issue) => issue.message).join(', '),
        request.url,
      );
    request.log.error({ err: error }, 'Unhandled request error');
    return problem(
      reply,
      500,
      'Internal Error',
      '요청을 처리하는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
      request.url,
    );
  });

  return app;
}
